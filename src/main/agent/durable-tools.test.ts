import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Type } from 'typebox'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import { createRegistry, type JsonObject } from '@earendil-works/pi-durable'
import { registerPiBuiltinTools } from './pi/adapters/piBuiltinToolAdapter'
import { ToolRegistry, type ToolAdapterContext } from '../tools/toolRegistry'
import { SandboxService } from '../sandbox/sandboxService'
import type { SandboxBackend } from '../sandbox/sandboxBackend'
import { AgentEngine } from './agent-engine'
import { DurableTools } from './durable-tools'

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
  options: { guard?: boolean; backend?: SandboxBackend; registry?: ToolRegistry } = {},
) {
  const registry = options.registry ?? new ToolRegistry()
  if (!options.registry) registerPiBuiltinTools(registry, '')
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
  const durableRegistry = createRegistry()
  let bridge: DurableTools
  const open = async (beforeResume?: (bridge: DurableTools) => Promise<unknown>) => {
    bridge = new DurableTools(registry, sandbox, retention, async () => adapter)
    durableRegistry.install(bridge.extension())
    durableRegistry.install(bridge.approvals.extension)
    const engine = await AgentEngine.open(join(directory, 'durable.sqlite'), {
      models, registry: durableRegistry, settings: { retry: { enabled: false } },
    }, context(), async (engine) => {
      bridge.connect(engine.harness)
      await beforeResume?.(bridge)
    })
    engines.push(engine)
    return { engine, bridge }
  }
  const { engine, bridge: tools } = await open()
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
    engine, bridge: tools, conversation, submission, registry, retention, workspace, finishRun, settle, open,
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
    adapter: { runtime: 'pi', create: () => ({ execute: executeDirect }) },
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
    adapter: { runtime: 'pi', create: () => ({ execute: async () => ({ content: [{ type: 'text', text: 'mcp-result' }], details: { serverId: 'server' } }) }) },
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
    adapter: { runtime: 'pi', create: () => ({ execute: async (_id, _args, signal: AbortSignal) => {
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
    adapter: { runtime: 'pi', create: () => ({ execute }) },
  })
  const { settle } = await setup('strict', {}, { registry })
  expect(JSON.stringify(await settle())).toContain('invalid_arguments')
  expect(execute).not.toHaveBeenCalled()
})
