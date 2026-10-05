import {
  DEFAULT_WEB_SEARCH_RESULTS,
  type WebSearchProviderName,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchSource,
} from '@/shared/web-search/webSearch'
import { normalizeWebSearchResult } from '../normalizeWebSearch'
import { postJson, type WebSearchProvider } from '../webSearchProvider'

const SEARCH_ENDPOINT = 'https://api.exa.ai/search'

interface ExaResult {
  title?: unknown
  url?: unknown
  publishedDate?: unknown
  highlights?: unknown
}

export class ExaWebSearchProvider implements WebSearchProvider {
  readonly id: WebSearchProviderName = 'exa'

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const payload = await postJson(this.fetchImpl, SEARCH_ENDPOINT, {
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: request.query,
        type: 'auto',
        numResults: request.maxResults ?? DEFAULT_WEB_SEARCH_RESULTS,
        contents: { highlights: true },
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
    const result = item as ExaResult
    if (typeof result.url !== 'string') return []
    const highlights = Array.isArray(result.highlights)
      ? result.highlights.filter((highlight): highlight is string => typeof highlight === 'string')
      : []
    return [
      {
        title: typeof result.title === 'string' ? result.title : result.url,
        url: result.url,
        ...(highlights.length ? { snippet: highlights.join('\n') } : {}),
        ...(typeof result.publishedDate === 'string' ? { publishedAt: result.publishedDate } : {}),
      },
    ]
  })
}
