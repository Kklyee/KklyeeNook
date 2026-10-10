import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { createRegistry } from '@earendil-works/pi-durable'
import type { AgentConfig } from '@/shared/agent/agentConfig'
import { MemoryCredentialStore } from '../settings/credentialStore'
import { AgentEngine } from './agent-engine'
import { AgentModels } from './agent-models'

const servers: Server[] = []
const engines: AgentEngine[] = []
const directories: string[] = []
const emptyAuth = { env: async () => undefined, fileExists: async () => false }
const context = () => withAbortSignal(AbortSignal.timeout(15_000), BACKGROUND_CONTEXT)

const config = (baseUrl = 'http://localhost:1234/v1'): AgentConfig => ({
  model: { provider: 'custom', modelID: 'custom-model', baseUrl, api: 'openai-completions', thinkingLevel: 'max' },
  tools: { enabled: [] },
})

async function server() {
  const requests: { path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push({ path: request.url!, headers: request.headers, body })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({
      id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'reply' }, finish_reason: null }],
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP server has no port')
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests }
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

test('custom provider dispatches a real local HTTP request with current settings credentials', async () => {
  const { baseUrl, requests } = await server()
  const credentials = new MemoryCredentialStore()
  credentials.setApiKey('custom', 'synthetic-first-key')
  const runtime = new AgentModels(() => config(baseUrl), () => credentials, emptyAuth)
  const model = runtime.models.getModel('custom', 'custom-model')!
  expect(runtime.selection()).toEqual({ model: { provider: 'custom', modelId: 'custom-model' }, thinkingLevel: 'off' })
  const answer = await runtime.models.completeSimple(model, { messages: [{ role: 'user', content: 'hello', timestamp: 1 }] })
  expect(answer.stopReason).toBe('stop')
  expect(answer.content).toMatchObject([{ type: 'text', text: 'reply' }])
  expect(requests[0]).toMatchObject({ path: '/v1/chat/completions', headers: { authorization: 'Bearer synthetic-first-key' }, body: { model: 'custom-model' } })
  credentials.setApiKey('custom', 'synthetic-rotated-key')
  await runtime.models.completeSimple(model, { messages: [] })
  expect(requests[1].headers.authorization).toBe('Bearer synthetic-rotated-key')
  credentials.deleteApiKey('custom')
  expect(await runtime.models.getAuth('custom')).toBeUndefined()
  expect((await runtime.models.completeSimple(model, { messages: [] })).stopReason).toBe('error')
  expect(requests).toHaveLength(2)
}, 20_000)

test('builtin model catalog data is preserved and provider overrides apply to actual requests', async () => {
  const { baseUrl, requests } = await server()
  const credentials = new MemoryCredentialStore()
  credentials.setApiKey('openai', 'synthetic-key')
  const original = builtinModels().getModels('openai')[0]
  const settings: AgentConfig = {
    model: { provider: 'openai', modelID: original.id },
    providers: [{ id: 'openai', name: 'Gateway', baseUrl, api: 'openai-completions', models: [{ id: original.id, name: 'Overridden', input: ['text', 'image'], contextWindow: 50_000, maxTokens: 4000, reasoning: false }] }],
    tools: { enabled: [] },
  }
  const runtime = new AgentModels(() => settings, () => credentials, emptyAuth)
  const model = runtime.models.getModel('openai', original.id)!
  expect(runtime.models.getProvider('openai')?.name).toBe('Gateway')
  expect(model).toMatchObject({ name: 'Overridden', api: 'openai-completions', baseUrl, input: ['text', 'image'], contextWindow: 50_000, maxTokens: 4000, reasoning: false, cost: original.cost })
  expect(runtime.models.getModels('openai')).toHaveLength(builtinModels().getModels('openai').length)
  expect((await runtime.models.completeSimple(model, { messages: [] })).stopReason).toBe('stop')
  expect(requests[0].path).toBe('/v1/chat/completions')
}, 20_000)

test('provider model definitions and saved profiles remain available with mixed APIs', () => {
  const settings: AgentConfig = {
    ...config(),
    providers: [{ id: 'custom', name: 'Mixed', baseUrl: 'http://localhost:1234/v1', models: [
      { id: 'responses', api: 'openai-responses', reasoning: true },
      { id: 'anthropic', api: 'anthropic-messages' },
    ] }],
    models: [{ id: 'custom:custom-model', provider: 'custom', modelID: 'custom-model', api: 'openai-completions', input: ['text', 'image'], thinkingLevel: 'high' }],
  }
  const runtime = new AgentModels(() => settings, () => new MemoryCredentialStore(), emptyAuth)
  expect(runtime.models.getModels('custom').map((model) => [model.id, model.api])).toEqual([
    ['custom-model', 'openai-completions'], ['responses', 'openai-responses'], ['anthropic', 'anthropic-messages'],
  ])
  expect(runtime.models.getModel('custom', 'custom-model')?.input).toEqual(['text', 'image'])
  expect(runtime.models.getModel('custom', 'responses')?.reasoning).toBe(true)
})

test('configuration reload replaces custom providers without exposing partial invalid updates', () => {
  let settings = config()
  const runtime = new AgentModels(() => settings, () => new MemoryCredentialStore(), emptyAuth)
  const before = runtime.models.getModel('custom', 'custom-model')
  settings = { ...settings, model: { ...settings.model, api: 'unsupported-api' } }
  expect(() => runtime.reload()).toThrow('Unsupported model API')
  expect(runtime.models.getModel('custom', 'custom-model')).toBe(before)
  settings = { model: { provider: 'next', modelID: 'next-model', baseUrl: 'http://localhost:4321/v1' }, tools: { enabled: [] } }
  runtime.reload()
  expect(runtime.models.getProvider('custom')).toBeUndefined()
  expect(runtime.models.getModel('next', 'next-model')?.baseUrl).toBe('http://localhost:4321/v1')
})

test('saved-model selection and reasoning capabilities use the installed pi-ai implementation', () => {
  const original = builtinModels().getModels('openai').find((model) => model.reasoning)!
  const settings: AgentConfig = {
    ...config(), activeModelId: 'reasoning',
    models: [
      { ...config().model, id: 'custom' },
      { id: 'reasoning', provider: 'openai', modelID: original.id, thinkingLevel: 'max' },
    ],
  }
  const runtime = new AgentModels(() => settings, () => new MemoryCredentialStore(), emptyAuth)
  expect(runtime.selection().model).toEqual({ provider: 'openai', modelId: original.id })
  expect(runtime.selection().thinkingLevel).not.toBe('off')
  settings.models![1] = { ...settings.models![1], modelID: 'missing-model' }
  expect(() => runtime.selection()).toThrow('Model is not available')
})

test('pi-ai API key login and logout persist through the existing application credential store', async () => {
  const credentials = new MemoryCredentialStore()
  const runtime = new AgentModels(() => config(), () => credentials, emptyAuth)
  await runtime.models.login('custom', 'api_key', { prompt: async () => 'synthetic-login-key', notify: vi.fn() })
  expect(credentials.getApiKey('custom')).toBe('synthetic-login-key')
  expect(await runtime.models.getAuth('custom')).toMatchObject({ auth: { apiKey: 'synthetic-login-key' } })
  await runtime.models.logout('custom')
  expect(credentials.hasApiKey('custom')).toBe(false)
})

test('Durable executes through real pi-ai HTTP dispatch without persisting credentials in its snapshot', async () => {
  const { baseUrl, requests } = await server()
  const directory = await mkdtemp(join(tmpdir(), 'nook-models-'))
  directories.push(directory)
  const credentials = new MemoryCredentialStore()
  credentials.setApiKey('custom', 'synthetic-private-key')
  const runtime = new AgentModels(() => config(baseUrl), () => credentials, emptyAuth)
  const engine = await AgentEngine.open(join(directory, 'durable.sqlite'), {
    models: runtime.models, registry: createRegistry(), settings: { retry: { enabled: false } },
  }, context())
  engines.push(engine)
  await engine.create('thread', runtime.selection(), context())
  const conversation = await engine.conversation('thread', context())
  const submission = await conversation.submit({ type: 'input', content: 'hello', requestId: 'request' }, context())
  expect((await submission.wait(context())).status).toBe('done')
  await conversation.waitForIdle(context())
  const entries = await conversation.entries({ order: 'ascending' }, 100, undefined, context())
  expect(JSON.stringify(entries.items)).toContain('reply')
  expect(JSON.stringify(entries.items)).not.toContain('synthetic-private-key')
  expect(JSON.stringify(await conversation.agent(context()))).not.toContain('synthetic-private-key')
  expect(requests).toHaveLength(1)
}, 20_000)
