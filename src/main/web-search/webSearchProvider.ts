import type {
  WebSearchProviderName,
  WebSearchRequest,
  WebSearchResult,
} from '@/shared/web-search/webSearch'
import { ExaWebSearchProvider } from './providers/exaWebSearchProvider'
import { TavilyWebSearchProvider } from './providers/tavilyWebSearchProvider'
import { WebSearchError, webSearchErrorFromStatus } from './webSearchErrors'

export interface WebSearchProvider {
  readonly id: WebSearchProviderName

  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>

  testConnection(signal?: AbortSignal): Promise<void>
}

export function createWebSearchProvider(
  provider: WebSearchProviderName,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): WebSearchProvider {
  return provider === 'exa'
    ? new ExaWebSearchProvider(apiKey, fetchImpl)
    : new TavilyWebSearchProvider(apiKey, fetchImpl)
}

export async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { ...init, method: 'POST' })
  const body = await response.text().catch(() => '')
  if (!response.ok) throw webSearchErrorFromStatus(response.status, body)
  try {
    const payload: unknown = JSON.parse(body)
    if (!payload || typeof payload !== 'object') throw new Error('not an object')
    return payload as Record<string, unknown>
  } catch {
    throw new WebSearchError('web_search_failed')
  }
}
