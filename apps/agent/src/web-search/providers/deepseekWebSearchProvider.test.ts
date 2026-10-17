import { expect, test, vi } from 'vitest'
import { DeepSeekWebSearchProvider } from './deepseekWebSearchProvider'

test('sends the DeepSeek search payload and maps summaries and dates to sources', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
    results: [
      { title: 'DeepSeek', url: 'https://api-docs.deepseek.com/', summary: 'Long summary', snippet: 'Short', date: '2026-10-17T00:00:00Z' },
      { url: 'https://example.com/', summary: '', snippet: 'Fallback' },
      { title: 'Missing URL' },
      { url: 'javascript:alert(1)' },
    ],
  })))
  const provider = new DeepSeekWebSearchProvider('deepseek-key', fetchImpl as unknown as typeof fetch)
  const controller = new AbortController()
  const result = await provider.search({ query: 'DeepSeek search', maxResults: 3 }, controller.signal)

  const [url, init] = fetchImpl.mock.calls[0]!
  expect(url).toBe('https://api.deepseek.com/v1/tools/search')
  expect(init).toMatchObject({
    method: 'POST',
    headers: { Authorization: 'Bearer deepseek-key', 'Content-Type': 'application/json' },
    signal: controller.signal,
  })
  expect(JSON.parse(String(init!.body))).toEqual({ query: 'DeepSeek search', count: 3, need_content: false })
  expect(result).toEqual({
    query: 'DeepSeek search',
    provider: 'deepseek',
    results: [
      { title: 'DeepSeek', url: 'https://api-docs.deepseek.com/', snippet: 'Long summary', publishedAt: '2026-10-17T00:00:00Z' },
      { title: 'https://example.com/', url: 'https://example.com/', snippet: 'Fallback' },
    ],
  })
})

test.each([
  [401, 'web_search_invalid_api_key'],
  [402, 'web_search_quota_exceeded'],
  [429, 'web_search_rate_limited'],
  [500, 'web_search_failed'],
])('maps DeepSeek HTTP %i errors without exposing response details', async (status, code) => {
  const provider = new DeepSeekWebSearchProvider('key', (async () => new Response(
    JSON.stringify({ error: { message: 'private details', code: 'error' } }), { status },
  )) as typeof fetch)
  await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code })
})

test('handles empty search results and probes a single result for connection tests', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"results":[]}'))
  const provider = new DeepSeekWebSearchProvider('key', fetchImpl as unknown as typeof fetch)
  expect(await provider.search({ query: 'nothing' })).toEqual({ query: 'nothing', provider: 'deepseek', results: [] })
  expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).count).toBe(5)
  await provider.testConnection()
  expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body)).count).toBe(1)
})
