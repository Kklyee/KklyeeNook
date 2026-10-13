export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const request: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  }
  const response = await fetch(`/api${path}`, request)
  const data = await response.json()
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Request failed')
  return data as T
}
import type { RemoteConversationSnapshot } from '@kklyeenook/shared/remote/index'

export const conversationSnapshots = new Map<string, RemoteConversationSnapshot>()
export function cacheConversation(id: string, snapshot: RemoteConversationSnapshot) {
  conversationSnapshots.delete(id)
  conversationSnapshots.set(id, snapshot)
  while (conversationSnapshots.size > 8) conversationSnapshots.delete(conversationSnapshots.keys().next().value!)
}
const loadingConversations = new Map<string, Promise<RemoteConversationSnapshot>>()

export function loadConversation(id: string) {
  let promise = loadingConversations.get(id)
  if (!promise) {
    const cached = conversationSnapshots.get(id)
    if (cached) { cacheConversation(id, cached); return Promise.resolve(cached) }
    promise = api<RemoteConversationSnapshot>(`/conversations/${id}`).then(snapshot => {
      const current = conversationSnapshots.get(id)
      if (current) return current
      cacheConversation(id, snapshot)
      return snapshot
    }).finally(() => loadingConversations.delete(id))
    loadingConversations.set(id, promise)
  }
  return promise
}
