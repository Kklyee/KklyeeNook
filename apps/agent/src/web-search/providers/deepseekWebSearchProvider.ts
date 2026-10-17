import {
  DEFAULT_WEB_SEARCH_RESULTS,
  type WebSearchProviderName,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchSource,
} from '@kklyeenook/shared/web-search/webSearch'
import { normalizeWebSearchResult } from '../normalizeWebSearch'
import { postJson, type WebSearchProvider } from '../webSearchProvider'

const SEARCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/search'

interface DeepSeekResult {
  title?: unknown
  url?: unknown
  summary?: unknown
  snippet?: unknown
  date?: unknown
}

export class DeepSeekWebSearchProvider implements WebSearchProvider {
  readonly id: WebSearchProviderName = 'deepseek'

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const payload = await postJson(this.fetchImpl, SEARCH_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: request.query,
        count: request.maxResults ?? DEFAULT_WEB_SEARCH_RESULTS,
        need_content: false,
      }),
      signal,
    })
    return normalizeWebSearchResult(
      { query: request.query, provider: this.id, results: [] },
      toSources(payload.results),
    )
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    await this.search({ query: 'test', maxResults: 1 }, signal)
  }
}

function toSources(value: unknown): WebSearchSource[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const result = item as DeepSeekResult
    if (typeof result.url !== 'string') return []
    const snippet = typeof result.summary === 'string' && result.summary.trim()
      ? result.summary
      : typeof result.snippet === 'string' ? result.snippet : ''
    return [
      {
        title: typeof result.title === 'string' ? result.title : result.url,
        url: result.url,
        ...(snippet ? { snippet } : {}),
        ...(typeof result.date === 'string' ? { publishedAt: result.date } : {}),
      },
    ]
  })
}
