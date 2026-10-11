import { expect, test, vi } from 'vitest'
import { ExaWebSearchProvider } from './exaWebSearchProvider'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('sends the Exa search payload and joins highlights into a snippet', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
    jsonResponse({
      results: [
        {
          title: 'Electron issue 12345',
          url: 'https://github.com/electron/electron/issues/12345',
          publishedDate: '2026-02-14',
          highlights: ['Acrylic turns black', 'when the window is maximized.'],
        },
        { url: 'https://example.com/no-highlights' },
      ],
    }),
  )
  const provider = new ExaWebSearchProvider('exa-secret', fetchImpl as unknown as typeof fetch)

  const result = await provider.search({ query: 'electron maximize', maxResults: 2 })

  const [url, init] = fetchImpl.mock.calls[0]!
  expect(url).toBe('https://api.exa.ai/search')
  expect(init).toMatchObject({
    method: 'POST',
    headers: { 'x-api-key': 'exa-secret', 'Content-Type': 'application/json' },
  })
  expect(JSON.parse(String(init!.body))).toEqual({
    query: 'electron maximize',
    type: 'auto',
    numResults: 2,
    contents: { highlights: true },
  })
  expect(result.provider).toBe('exa')
  expect(result.results).toEqual([
    {
      title: 'Electron issue 12345',
      url: 'https://github.com/electron/electron/issues/12345',
      snippet: 'Acrylic turns black when the window is maximized.',
      publishedAt: '2026-02-14',
    },
    { title: 'https://example.com/no-highlights', url: 'https://example.com/no-highlights' },
  ])
})

test('testConnection runs a single-result search', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ results: [] }))
  await new ExaWebSearchProvider('key', fetchImpl as unknown as typeof fetch).testConnection()
  expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toMatchObject({
    query: 'test',
    numResults: 1,
  })
})

test('maps an invalid key response to invalid_api_key', async () => {
  const provider = new ExaWebSearchProvider(
    'key',
    (async (_url: string, _init?: RequestInit) => new Response('invalid api key', { status: 401 })) as unknown as typeof fetch,
  )
  await expect(provider.testConnection()).rejects.toMatchObject({
    code: 'web_search_invalid_api_key',
  })
})
