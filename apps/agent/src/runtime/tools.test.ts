import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Type } from 'typebox'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from '@earendil-works/pi-ai/providers/faux'
import { createRegistry, type JsonObject } from '@earendil-works/pi-durable'
import { registerBuiltinTools } from '../tools/builtin-tools'
import { ToolRegistry, type ToolAdapterContext } from '../tools/toolRegistry'
import { SandboxService } from '../sandbox/sandboxService'
import type { SandboxBackend } from '../sandbox/sandboxBackend'
import { AgentEngine } from './agent-engine'
import { AgentTools } from './tools'
import type { ToolResultRetentionPolicy } from '../tools/toolResultRetentionPolicy'
import { FileToolResultRetentionPolicy } from '../tools/toolResultRetentionPolicy'
import { ToolResultStore } from '../tools/toolResultStore'

let directory: string
const engines: AgentEngine[] = []
const context = () => withAbortSignal(AbortSignal.timeout(15_000), BACKGROUND_CONTEXT)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-tools-'))
  await mkdir(join(directory, 'workspace'))
})

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  await rm(directory, { recursive: true, force: true })
})

async function setup(
  name: string, args: JsonObject,
  options: { guard?: boolean; backend?: SandboxBackend; registry?: ToolRegistry; responses?: FauxResponseStep[]; retention?: ToolResultRetentionPolicy } = {},
) {
  const registry = options.registry ?? new ToolRegistry()
  if (!options.registry) registerBuiltinTools(registry, '')
  const workspace = join(directory, 'workspace')
  let adapter: ToolAdapterContext = {
    cwd: workspace,
    executionContext: {
      conversationId: 'thread', mode: 'read-only', workspaceId: 'ws',
      workspace: { id: 'ws', rootPath: workspace },
    },
  }
  const finishRun = vi.fn(async () => undefined)
  const backend: SandboxBackend = options.backend ?? {
    support: () => 'partial', execute: vi.fn(), finishRun,
  }
  const sandbox = new SandboxService(backend)
  const retention = { process: vi.fn(async (_run, _id, result) => result) }
  const faux = fauxProvider()
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' }),
    fauxAssistantMessage('finished'),
  ])
  const models = createModels()
  models.setProvider(faux.provider)
  const agentRegistry = createRegistry()
  let bridge: AgentTools
  const open = async (beforeResume?: (bridge: AgentTools) => Promise<unknown>) => {
    bridge = new AgentTools(registry, sandbox, options.retention ?? retention, async () => adapter)
    agentRegistry.install(bridge.extension())
    agentRegistry.install(bridge.approvals.extension)
    const engine = await AgentEngine.open(join(directory, 'durable.sqlite'), {
      models, registry: agentRegistry, settings: { retry: { enabled: false } },
    }, context(), async (engine) => {
      bridge.connect(engine.harness)
      await beforeResume?.(bridge)
    })
    engines.push(engine)
    return { engine, bridge }
  }
  const { engine, bridge: tools } = await open()
  if (options.responses) faux.setResponses(options.responses)
  const extension = tools.extension()
  await engine.create('thread', {
    model: { provider: 'faux', modelId: 'faux-1' }, tools: extension.tools,
    extensions: options.guard === false ? [extension] : [extension, tools.approvals.extension],
  }, context())
  const conversation = await engine.conversation('thread', context())
  const submission = await conversation.submit({ type: 'input', content: 'execute', requestId: 'request' }, context())
  const settle = async (host = engine) => {
    await (await host.submission('thread', submission.id, context())).wait(context())
    const current = await host.conversation('thread', context())
    await current.waitForIdle(context())
    return (await current.entries({ order: 'ascending' }, 100, undefined, context())).items
      .find((entry) => entry.kind === 'pi.tool-result')!
  }
  return {
    engine, bridge: tools, conversation, submission, registry, retention, workspace, finishRun, settle, open, faux,
    setAdapter: (value: ToolAdapterContext) => { adapter = value },
  }
}

test('approved write uses the existing harness and does not change the conversation permission mode', async () => {
  const { bridge, conversation, workspace, settle, retention, finishRun } = await setup('write', { path: 'file.txt', content: 'data' })
  await vi.waitFor(async () => expect(await bridge.approvals.pending(conversation.id, context())).toHaveLength(1))
  const [request] = await bridge.approvals.pending(conversation.id, context())
  await expect(readFile(join(workspace, 'file.txt'))).rejects.toThrow()
  expect(request.request).toMatchObject({ requestedMode: 'workspace-write', permission: { mode: 'read-only' } })
  await bridge.approvals.decide(conversation.id, request.id, 'approved', context())
  expect((await settle()).model?.[0]).toMatchObject({ role: 'toolResult', isError: false })
  expect(await readFile(join(workspace, 'file.txt'), 'utf8')).toBe('data')
  expect(retention.process).toHaveBeenCalledTimes(1)
  expect(finishRun).toHaveBeenCalledTimes(1)
})

test('read-only can read within the workspace without an approval', async () => {
  const path = join(directory, 'workspace', 'file.txt')
  await writeFile(path, 'one\ntwo\nthree')
  const { bridge, conversation, settle } = await setup('read', { path: 'file.txt', offset: 2, limit: 1 })
  const result = await settle()
  expect(result.model?.[0]).toMatchObject({ content: [{ type: 'text', text: 'two' }], isError: false })
  expect(await bridge.approvals.pending(conversation.id, context())).toEqual([])
})

test('denied outside reads and writes without the guard fail closed', async () => {
  const outside = join(directory, 'outside.txt')
  await writeFile(outside, 'outside')
  const denied = await setup('read', { path: outside })
  expect(JSON.stringify(await denied.settle())).toContain('目标在工作区外')
  await denied.engine.close()
  await rm(join(directory, 'durable.sqlite'), { force: true })
  const unguarded = await setup('write', { path: 'file.txt', content: 'denied' }, { guard: false })
  expect(JSON.stringify(await unguarded.settle())).toContain('PERMISSION_DENIED')
  await expect(readFile(join(unguarded.workspace, 'file.txt'))).rejects.toThrow()
})

test('recovered approval cannot elevate a changed workspace authorization', async () => {
  const { engine, bridge, conversation, setAdapter, open, workspace, settle } = await setup('write', { path: 'file.txt', content: 'data' })
  await vi.waitFor(async () => expect(await bridge.approvals.pending(conversation.id, context())).toHaveLength(1))
  const [request] = await bridge.approvals.pending(conversation.id, context())
  await engine.close()
  const other = join(directory, 'other-workspace')
  await mkdir(other)
  setAdapter({ cwd: other, executionContext: { conversationId: 'thread', mode: 'read-only', workspace: { id: 'other', rootPath: other } } })
  const restored = await open((bridge) => bridge.approvals.decide(conversation.id, request.id, 'approved', context()))
  expect(JSON.stringify(await settle(restored.engine))).toContain('Approval request changed')
  await expect(readFile(join(other, 'file.txt'))).rejects.toThrow()
  await expect(readFile(join(workspace, 'file.txt'))).rejects.toThrow()
})

test('restricted commands enter SandboxService instead of the direct tool executor', async () => {
  const registry = new ToolRegistry()
  const executeDirect = vi.fn(async () => { throw new Error('direct execution forbidden') })
  registry.register({
    definition: { name: 'bash', label: 'Shell', description: 'Shell', inputSchema: Type.Object({ command: Type.String() }) },
    adapter: { create: () => ({ execute: executeDirect }) },
  })
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'restricted' }], details: {}, isError: false }))
  const finishRun = vi.fn(async () => undefined)
  const { settle } = await setup('bash', { command: 'echo restricted' }, {
    registry, backend: { support: () => 'partial', execute, finishRun },
  })
  expect(JSON.stringify(await settle())).toContain('restricted')
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ mode: 'read-only', command: 'echo restricted' }))
  expect(executeDirect).not.toHaveBeenCalled()
  expect(finishRun).toHaveBeenCalledTimes(1)
})

test('dynamic MCP-style tools retain schema, result metadata and unsafe recovery policy', async () => {
  const registry = new ToolRegistry()
  registry.register({
    definition: { name: 'mcp__server__fetch', label: 'Fetch', description: 'Fetch', inputSchema: Type.Object({ key: Type.String() }) },
    adapter: { create: () => ({ execute: async () => ({ content: [{ type: 'text', text: 'mcp-result' }], details: { serverId: 'server' } }) }) },
  })
  const { bridge, conversation, settle } = await setup('mcp__server__fetch', { key: 'key' }, { registry })
  await vi.waitFor(async () => expect(await bridge.approvals.pending(conversation.id, context())).toHaveLength(1))
  const [request] = await bridge.approvals.pending(conversation.id, context())
  await bridge.approvals.decide(conversation.id, request.id, 'approved', context())
  const [tool] = bridge.extension().tools!
  expect(tool.replay).toBe('unsafe')
  expect(tool.parameters).toEqual(registry.get(tool.name)?.inputSchema)
  const result = await settle()
  expect(result.model?.[0]).toMatchObject({ role: 'toolResult', isError: false, details: { status: 'success', details: { serverId: 'server' } } })
})

test('cancellation reaches the tool AbortSignal and releases sandbox resources', async () => {
  const registry = new ToolRegistry()
  const aborted = vi.fn()
  const started = Promise.withResolvers<void>()
  registry.register({
    definition: { name: 'wait', label: 'Wait', description: 'Wait', inputSchema: Type.Object({}) },
    adapter: { create: () => ({ execute: async (_id, _args, signal: AbortSignal) => {
      started.resolve()
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => { aborted(); resolve() }, { once: true }))
      return { content: [] }
    } }) },
  })
  const { conversation, finishRun } = await setup('wait', {}, { registry })
  await started.promise
  await conversation.abort(context())
  expect(aborted).toHaveBeenCalledTimes(1)
  expect(finishRun).toHaveBeenCalledTimes(1)
})

test('invalid tool arguments never reach the registry executor', async () => {
  const registry = new ToolRegistry()
  const execute = vi.fn()
  registry.register({
    definition: { name: 'strict', label: 'Strict', description: 'Strict', inputSchema: Type.Object({ key: Type.String() }) },
    adapter: { create: () => ({ execute }) },
  })
  const { settle } = await setup('strict', {}, { registry })
  expect(JSON.stringify(await settle())).toContain('invalid_arguments')
  expect(execute).not.toHaveBeenCalled()
})


test('tool failures and unknown calls finish as model results so the agent can correct them', async () => {
  const registry = new ToolRegistry()
  const execute = vi.fn(async (_id: string, args: { key: string }) => {
    if (args.key === 'fail') throw new Error('tool failed')
    return { content: [{ type: 'text', text: 'corrected' }], details: {} }
  })
  registry.register({ definition: { name: 'strict', label: 'Strict', description: 'Strict', inputSchema: Type.Object({ key: Type.String() }) }, adapter: { create: () => ({ execute }) } })
  const calls: JsonObject[] = [{}, { key: 'fail' }, {}, { key: 'ok' }]
  const responses = calls.map((args, index) => fauxAssistantMessage(fauxToolCall(index === 2 ? 'unknown' : 'strict', args, { id: 'call-' + index }), { stopReason: 'toolUse' }))
  const { conversation, settle, faux } = await setup('strict', {}, { registry, responses: [...responses, fauxAssistantMessage('finished')] })
  await settle()
  const entries = (await conversation.entries({ order: 'ascending' }, 100, undefined, context())).items
  const results = entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult')
  expect(results.map(result => result.isError)).toEqual([true, true, true, false])
  expect(JSON.stringify(results)).toContain('tool failed')
  expect(execute.mock.calls.map(([, args]) => args)).toEqual([{ key: 'fail' }, { key: 'ok' }])
  expect(faux.state.callCount).toBe(5)
  expect(JSON.stringify(entries.at(-1))).toContain('finished')
})

test('retention failures become explicit SDK tool errors without repeating execution', async () => {
  const registry = new ToolRegistry()
  registry.register({ definition: { name: 'result', label: 'Result', description: 'Result', inputSchema: Type.Object({}) }, adapter: { create: () => ({ execute: async () => ({ content: [{ type: 'text', text: 'done' }], details: {} }) }) } })
  const { settle, faux } = await setup('result', {}, { registry, retention: { process: async () => { throw new Error('disk full') } } })
  const result = await settle()
  expect(result.model?.[0]).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('disk full') }] })
  expect(faux.state.callCount).toBe(2)
})

test('the model receives retained previews while full tool output remains readable', async () => {
  const registry = new ToolRegistry()
  const text = 'HEAD' + 'x'.repeat(120000) + 'TAIL'
  const store = new ToolResultStore(join(directory, 'results'))
  registry.register({ definition: { name: 'large', label: 'Large', description: 'Large', inputSchema: Type.Object({}) }, adapter: { create: () => ({ execute: async () => ({ content: [{ type: 'text', text }], details: {} }) }) } })
  let resultRef: string | undefined
  const { settle } = await setup('large', {}, { registry, retention: new FileToolResultRetentionPolicy(store), responses: [
    fauxAssistantMessage(fauxToolCall('large', {}, { id: 'large-call' }), { stopReason: 'toolUse' }),
    transcript => {
      const result = transcript.messages.at(-1)
      expect(result).toMatchObject({ role: 'toolResult', isError: false, details: { status: 'success', retention: { truncated: true } } })
      expect(JSON.stringify(result)).not.toContain(text)
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(32 * 1024)
      if (result?.role !== 'toolResult') throw new Error('Missing tool result')
      resultRef = (result.details as { retention: { resultRef: string } }).retention.resultRef
      return fauxAssistantMessage('finished')
    },
  ] })
  await settle()
  expect(resultRef).toBeDefined()
  expect((await store.load(resultRef!)).result.content).toEqual([{ type: 'text', text }])
})

test('an approved write does not authorize the next call without another approval', async () => {
  const { bridge, conversation, workspace, settle } = await setup('write', {}, { responses: [
    fauxAssistantMessage(fauxToolCall('write', { path: 'file.txt', content: 'once' }, { id: 'first' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('write', { path: 'file.txt', content: 'twice' }, { id: 'second' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('finished'),
  ] })
  await vi.waitFor(async () => expect(await bridge.approvals.pending(conversation.id, context())).toHaveLength(1))
  const [first] = await bridge.approvals.pending(conversation.id, context())
  await bridge.approvals.decide(conversation.id, first.id, 'approved', context())
  await vi.waitFor(async () => {
    const pending = await bridge.approvals.pending(conversation.id, context())
    expect(pending).toHaveLength(1)
    expect(pending[0].id).not.toBe(first.id)
  })
  const [second] = await bridge.approvals.pending(conversation.id, context())
  await bridge.approvals.decide(conversation.id, second.id, 'rejected', context())
  expect((await settle()).model?.[0]).toMatchObject({ isError: false })
  expect(await readFile(join(workspace, 'file.txt'), 'utf8')).toBe('once')
  const entries = (await conversation.entries({ order: 'ascending' }, 100, undefined, context())).items
  expect(entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult').at(-1)).toMatchObject({ isError: true })
})
