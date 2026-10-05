import {
  DEFAULT_WEB_SEARCH_RESULTS,
  type WebSearchProviderName,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchSource,
} from '@/shared/web-search/webSearch'
import { normalizeWebSearchResult } from '../normalizeWebSearch'
import { postJson, type WebSearchProvider } from '../webSearchProvider'

const SEARCH_ENDPOINT = 'https://api.tavily.com/search'

interface TavilyResult {
  title?: unknown
  url?: unknown
  content?: unknown
  published_date?: unknown
}

export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly id: WebSearchProviderName = 'tavily'

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
        search_depth: 'basic',
        max_results: request.maxResults ?? DEFAULT_WEB_SEARCH_RESULTS,
        include_answer: false,
        include_raw_content: false,
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
    const result = item as TavilyResult
    if (typeof result.url !== 'string') return []
    return [
      {
        title: typeof result.title === 'string' ? result.title : result.url,
        url: result.url,
        ...(typeof result.content === 'string' ? { snippet: result.content } : {}),
        ...(typeof result.published_date === 'string' ? { publishedAt: result.published_date } : {}),
      },
    ]
  })
}
