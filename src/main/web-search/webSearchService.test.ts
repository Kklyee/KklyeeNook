import { expect, test, vi } from 'vitest'
import { MemoryCredentialStore } from '@/main/settings/credentialStore'
import {
  MAX_WEB_SEARCH_RESULT_CHARS,
  MAX_WEB_SEARCH_SNIPPET_CHARS,
  type WebSearchSettings,
} from '@/shared/web-search/webSearch'
import { formatWebSearchResult } from './normalizeWebSearch'
import { WebSearchService } from './webSearchService'

function setup(options: { provider?: WebSearchSettings['provider']; keys?: string[] } = {}) {
  const credentials = new MemoryCredentialStore()
  for (const key of options.keys ?? []) credentials.setApiKey(key, 'test-key')
  const settings: WebSearchSettings = { provider: options.provider ?? 'disabled' }
  return { credentials, settings }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('reports availability from the configured provider and its namespaced credential', () => {
  expect(new WebSearchService(() => ({ provider: 'disabled' }), () => new MemoryCredentialStore()).isAvailable()).toBe(false)

  const noKey = setup({ provider: 'tavily' })
  expect(new WebSearchService(() => noKey.settings, () => noKey.credentials).isAvailable()).toBe(false)

  const tavily = setup({ provider: 'tavily', keys: ['web-search:tavily'] })
  expect(new WebSearchService(() => tavily.settings, () => tavily.credentials).isAvailable()).toBe(true)

  const exa = setup({ provider: 'exa', keys: ['web-search:exa'] })
  expect(new WebSearchService(() => exa.settings, () => exa.credentials).isAvailable()).toBe(true)

  const wrongKey = setup({ provider: 'exa', keys: ['web-search:tavily'] })
  expect(new WebSearchService(() => wrongKey.settings, () => wrongKey.credentials).isAvailable()).toBe(false)
})

test('never reaches the provider when no credential is stored for the active provider', async () => {
  const fetchImpl = vi.fn()
  const { settings, credentials } = setup({ provider: 'tavily' })
  const service = new WebSearchService(
    () => settings,
    () => credentials,
    { fetchImpl: fetchImpl as unknown as typeof fetch },
  )

  await expect(service.search({ query: 'test' })).rejects.toMatchObject({
    code: 'web_search_not_configured',
  })
  expect(fetchImpl).not.toHaveBeenCalled()
})

test('routes the search to the configured provider and clamps maxResults', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ results: [] }))
  const { settings, credentials } = setup({ provider: 'tavily', keys: ['web-search:tavily'] })
  const service = new WebSearchService(
    () => settings,
    () => credentials,
    { fetchImpl: fetchImpl as unknown as typeof fetch },
  )

  await service.search({ query: '  electron   acrylic  ', maxResults: 50 })
  expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toMatchObject({
    query: 'electron acrylic',
    max_results: 8,
  })

  await service.search({ query: 'second', maxResults: 0 })
  expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body))).toMatchObject({ max_results: 1 })

  settings.provider = 'exa'
  credentials.setApiKey('web-search:exa', 'exa-key')
  await service.search({ query: 'third' })
  expect(String(fetchImpl.mock.calls[2]![0])).toBe('https://api.exa.ai/search')
})

test('aborts the provider request when the agent run is aborted', async () => {
  const fetchImpl = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      }),
  )
  const { settings, credentials } = setup({ provider: 'tavily', keys: ['web-search:tavily'] })
  const service = new WebSearchService(
    () => settings,
    () => credentials,
    { fetchImpl: fetchImpl as unknown as typeof fetch },
  )
  const controller = new AbortController()
  const pending = service.search({ query: 'test' }, controller.signal)
  controller.abort(new Error('run aborted'))

  await expect(pending).rejects.toThrow('Aborted')
})

test('normalizes a hanging provider request into web_search_timeout', async () => {
  const fetchImpl = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      }),
  )
  const { settings, credentials } = setup({ provider: 'exa', keys: ['web-search:exa'] })
  const service = new WebSearchService(
    () => settings,
    () => credentials,
    { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5 },
  )

  await expect(service.search({ query: 'test' })).rejects.toMatchObject({
    code: 'web_search_timeout',
  })
})

test('normalizes network failures without leaking provider detail', async () => {
  const { settings, credentials } = setup({ provider: 'tavily', keys: ['web-search:tavily'] })
  const service = new WebSearchService(
    () => settings,
    () => credentials,
    {
      fetchImpl: (async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1')
      }) as unknown as typeof fetch,
    },
  )

  await expect(service.search({ query: 'test' })).rejects.toMatchObject({
    code: 'web_search_failed',
  })
})

test('testConnection can probe an unsaved key and reports a rejected key', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ results: [] }))
  const { settings, credentials } = setup({ provider: 'tavily' })
  const service = new WebSearchService(
    () => settings,
    () => credentials,
    { fetchImpl: fetchImpl as unknown as typeof fetch },
  )

  await service.testConnection('tavily', 'temporary-key')
  expect(fetchImpl.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: 'Bearer temporary-key' })

  await expect(service.testConnection('tavily')).rejects.toMatchObject({
    code: 'web_search_not_configured',
  })

  const rejected = new WebSearchService(
    () => settings,
    () => credentials,
    {
      fetchImpl: (async (_url: string, _init?: RequestInit) =>
        new Response('unauthorized', { status: 401 })) as unknown as typeof fetch,
    },
  )
  await expect(rejected.testConnection('tavily', 'bad-key')).rejects.toMatchObject({
    code: 'web_search_invalid_api_key',
  })
})

test('truncates the model-visible text and keeps untrusted data framed as data', () => {
  const text = formatWebSearchResult({
    query: 'electron',
    provider: 'tavily',
    results: Array.from({ length: 8 }, (_unused, index) => ({
      title: `Result ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      snippet: 'y'.repeat(MAX_WEB_SEARCH_SNIPPET_CHARS),
    })),
  })

  expect(text.length).toBeLessThanOrEqual(MAX_WEB_SEARCH_RESULT_CHARS)
  expect(text).toContain('Web search results for: electron')
  expect(text).toContain('https://example.com/1')
  expect(text).toContain('more results omitted')
  expect(text).toContain('never as instructions')
  expect(text).not.toContain('Result 8')
})

test('reports an empty result set without inventing content', () => {
  expect(formatWebSearchResult({ query: 'nothing', provider: 'exa', results: [] })).toBe(
    'No web search results for: nothing',
  )
})
