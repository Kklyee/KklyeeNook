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
  }
  const response = await fetch(`/api${path}`, request)
  const data = await response.json()
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Request failed')
  return data as T
}
import type { RemoteConversationSnapshot } from '@kklyeenook/shared/remote/index'

export const conversationSnapshots = new Map<string, RemoteConversationSnapshot>()
const loadingConversations = new Map<string, Promise<RemoteConversationSnapshot>>()

export function loadConversation(id: string) {
  let promise = loadingConversations.get(id)
  if (!promise) {
    promise = api<RemoteConversationSnapshot>(`/conversations/${id}`).then(snapshot => { conversationSnapshots.set(id, snapshot); return snapshot }).finally(() => loadingConversations.delete(id))
    loadingConversations.set(id, promise)
  }
  return promise
}
