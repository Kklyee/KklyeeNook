import { expect, test, vi } from 'vitest'
import { TavilyWebSearchProvider } from './tavilyWebSearchProvider'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('sends the Tavily search payload and normalizes results', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
    jsonResponse({
      results: [
        {
          title: 'BrowserWindow | Electron',
          url: 'https://www.electronjs.org/docs/latest/api/browser-window',
          content: 'BrowserWindow supports system backdrop materials.',
          published_date: '2026-01-05',
        },
        { title: 'missing url', content: 'dropped' },
        { title: 'bad scheme', url: 'javascript:alert(1)', content: 'dropped' },
      ],
    }),
  )
  const provider = new TavilyWebSearchProvider('tvly-secret', fetchImpl as unknown as typeof fetch)

  const result = await provider.search({ query: 'Electron acrylic', maxResults: 3 })

  expect(fetchImpl).toHaveBeenCalledOnce()
  const [url, init] = fetchImpl.mock.calls[0]!
  expect(url).toBe('https://api.tavily.com/search')
  expect(init).toMatchObject({
    method: 'POST',
    headers: {
      Authorization: 'Bearer tvly-secret',
      'Content-Type': 'application/json',
    },
  })
  expect(JSON.parse(String(init!.body))).toEqual({
    query: 'Electron acrylic',
    search_depth: 'basic',
    max_results: 3,
    include_answer: false,
    include_raw_content: false,
  })
  expect(result).toEqual({
    query: 'Electron acrylic',
    provider: 'tavily',
    results: [
      {
        title: 'BrowserWindow | Electron',
        url: 'https://www.electronjs.org/docs/latest/api/browser-window',
        snippet: 'BrowserWindow supports system backdrop materials.',
        publishedAt: '2026-01-05',
      },
    ],
  })
})

test.each([
  [401, 'unauthorized', 'web_search_invalid_api_key'],
  [403, 'forbidden', 'web_search_invalid_api_key'],
  [402, 'insufficient credits', 'web_search_quota_exceeded'],
  [429, 'rate limit exceeded', 'web_search_rate_limited'],
  [500, 'internal error', 'web_search_failed'],
])('maps HTTP %i to %s', async (status, body, code) => {
  const provider = new TavilyWebSearchProvider(
    'tvly-secret',
    (async (_url: string, _init?: RequestInit) => new Response(body, { status })) as unknown as typeof fetch,
  )
  await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code })
})

test('defaults to five results when the request omits a limit', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ results: [] }))
  await new TavilyWebSearchProvider('key', fetchImpl as unknown as typeof fetch).search({
    query: 'test',
  })
  expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).max_results).toBe(5)
})
