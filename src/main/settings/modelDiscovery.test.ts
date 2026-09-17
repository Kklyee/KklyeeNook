import { expect, test, vi } from 'vitest'

import { discoverRemoteModels, parseDiscoveredModels, toModelsEndpoint } from './modelDiscovery'

test('builds a model endpoint from a provider base URL', () => {
  expect(toModelsEndpoint('https://example.test/v1/')).toBe('https://example.test/v1/models')
})

test('parses OpenAI-compatible model catalogs with safe defaults', () => {
  expect(
    parseDiscoveredModels({
      data: [
        { id: 'deepseek-v4.1-flash', display_name: 'DeepSeek V4.1 Flash' },
        { id: 'deepseek-v4.1-flash' },
      ],
    }),
  ).toEqual([
    {
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      api: 'openai-completions',
      reasoning: false,
      input: ['text'],
      availableThinkingLevels: ['off'],
      contextWindow: 128_000,
      maxTokens: 16_384,
      builtin: false,
    },
  ])
})

test('sends the API key only to the discovery request', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer secret' })
    return new Response(JSON.stringify({ data: [{ id: 'model-1' }] }), { status: 200 })
  })

  await expect(
    discoverRemoteModels({ baseUrl: 'https://example.test/v1', apiKey: 'secret', fetchImpl }),
  ).resolves.toHaveLength(1)
})
