import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from 'pi-ai-legacy'
import { Type } from 'typebox'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import { ToolResultStore } from '@/main/tools/toolResultStore'
import { FileToolResultRetentionPolicy } from '@/main/tools/toolResultRetentionPolicy'
import { SandboxService } from '@/main/sandbox/sandboxService'
import { ToolExecutionHarness } from '@/main/agent/toolExecutionHarness'
import { normalizeToolResult } from '@/shared/tool/toolExecutionResult'
import { installPiToolExecutionHarness } from './piToolExecutionAdapter'
import { convertPiEvent } from './piEventAdapter'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-pi-contract-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const model: Model<'openai-completions'> = {
  id: 'test',
  name: 'Test',
  provider: 'test',
  api: 'openai-completions',
  baseUrl: 'https://example.test',
  reasoning: false,
  input: ['text'],
  contextWindow: 128000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

test('strict arguments, execution failures and unknown tools produce finished results and the run continues', async () => {
  const registry = new ToolRegistry()
  const parameters = Type.Object({ path: Type.String() })
  const execute = vi.fn(async (_id: string, args: { path: string }) => {
    if (args.path === 'throw') throw new Error('tool failed')
    return { content: [{ type: 'text' as const, text: 'corrected' }], details: {} }
  })
  registry.register({
    definition: { name: 'test_tool', label: 'Test', description: 'Test', inputSchema: parameters },
    adapter: {
      runtime: 'pi',
      create: () => ({
        name: 'test_tool',
        label: 'Test',
        description: 'Test',
        parameters,
        execute,
      }),
    },
  })
  const tools = registry.resolve<any>('pi', ['test_tool'], {})
  let requests = 0
  const results: Array<{ status: string; code?: string }> = []
  const agent = new Agent({
    initialState: { model, tools },
    streamFn: (model, context) => {
      requests += 1
      expect(context.tools?.[0].parameters).toMatchObject({
        type: 'object',
        properties: { path: { type: 'string' } },
      })
      const previous = context.messages.at(-1)
      if (previous?.role === 'toolResult') {
        const result = normalizeToolResult(
          { content: previous.content, details: previous.details },
          previous.isError,
        )
        results.push({ status: result.status, code: result.error?.code })
        expect(previous.isError).toBe(result.status === 'error')
      }
      const calls = [
        { name: 'test_tool', arguments: { path: 42 } },
        { name: 'test_tool', arguments: { path: 'throw' } },
        { name: 'unknown', arguments: {} },
        { name: 'test_tool', arguments: { path: 'ok' } },
      ]
      const call = calls[requests - 1]
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        content: call
          ? [{ type: 'toolCall', id: `call-${requests}`, ...call }]
          : [{ type: 'text', text: 'done' }],
        stopReason: call ? 'toolUse' : 'stop',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
      const stream = createAssistantMessageEventStream()
      stream.push({ type: 'done', reason: call ? 'toolUse' : 'stop', message })
      return stream
    },
  })
  const harness = new ToolExecutionHarness(
    registry,
    new SandboxService(),
    new FileToolResultRetentionPolicy(new ToolResultStore(directory)),
  )
  installPiToolExecutionHarness(agent, registry, harness, {}, () => 'run-1')
  const events: AgentEvent[] = []
  agent.subscribe((event) => {
    events.push(event)
  })
  await agent.prompt('run')
  expect(requests).toBe(5)
  expect(execute.mock.calls.map(([, args]) => args)).toEqual([{ path: 'throw' }, { path: 'ok' }])
  const finished = events
    .filter((event) => event.type === 'tool_execution_end')
    .map((event) => convertPiEvent(event as never))
  expect(finished).toMatchObject([
    { type: 'tool_finished', result: { error: { code: 'INVALID_ARGUMENTS' } } },
    { type: 'tool_finished', result: { error: { code: 'EXECUTION_ERROR' } } },
    { type: 'tool_finished', result: { error: { code: 'UNKNOWN_TOOL' } } },
    { type: 'tool_finished', result: { status: 'success' } },
  ])
  expect(results).toEqual([
    { status: 'error', code: 'INVALID_ARGUMENTS' },
    { status: 'error', code: 'EXECUTION_ERROR' },
    { status: 'error', code: 'UNKNOWN_TOOL' },
    { status: 'success', code: undefined },
  ])
  expect(agent.state.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop' })
  expect(events.at(-1)?.type).toBe('agent_end')
})

test('a broken retention policy fails the agent instead of hiding a harness failure', async () => {
  const registry = new ToolRegistry()
  const parameters = Type.Object({})
  registry.register({
    definition: { name: 'test_tool', label: 'Test', description: 'Test', inputSchema: parameters },
    adapter: {
      runtime: 'pi',
      create: () => ({
        name: 'test_tool',
        label: 'Test',
        description: 'Test',
        parameters,
        execute: async () => ({ content: [{ type: 'text', text: 'done' }], details: {} }),
      }),
    },
  })
  let requests = 0
  const agent = new Agent({
    initialState: { model, tools: registry.resolve<any>('pi', ['test_tool'], {}) },
    streamFn: (model) => {
      requests += 1
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        content: [{ type: 'toolCall', id: 'broken', name: 'test_tool', arguments: {} }],
        stopReason: 'toolUse',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
      const stream = createAssistantMessageEventStream()
      stream.push({ type: 'done', reason: 'toolUse', message })
      return stream
    },
  })
  const harness = new ToolExecutionHarness(registry, new SandboxService(), {
    process: async () => {
      throw new Error('disk full')
    },
  })
  installPiToolExecutionHarness(agent, registry, harness, {}, () => 'run-1')
  const events: AgentEvent[] = []
  agent.subscribe((event) => {
    events.push(event)
  })
  await agent.prompt('run')
  expect(requests).toBe(1)
  expect(convertPiEvent(events.at(-1) as never)).toEqual({
    type: 'agent_failed',
    error: 'disk full',
  })
})

test('large tool results reach the model only as retained previews', async () => {
  const registry = new ToolRegistry()
  const parameters = Type.Object({})
  const text = `HEAD${'x'.repeat(120000)}TAIL`
  registry.register({
    definition: { name: 'test_tool', label: 'Test', description: 'Test', inputSchema: parameters },
    adapter: {
      runtime: 'pi',
      create: () => ({
        name: 'test_tool',
        label: 'Test',
        description: 'Test',
        parameters,
        execute: async () => ({ content: [{ type: 'text', text }], details: {} }),
      }),
    },
  })
  let requests = 0
  const agent = new Agent({
    initialState: { model, tools: registry.resolve<any>('pi', ['test_tool'], {}) },
    streamFn: (model, context) => {
      requests += 1
      if (requests === 2) {
        const result = context.messages.at(-1)
        expect(result).toMatchObject({
          role: 'toolResult',
          details: {
            status: 'success',
            retention: { truncated: true, resultRef: 'tool-result://run-1/large' },
          },
        })
        expect(JSON.stringify(result)).not.toContain(text)
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(32 * 1024)
      }
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        content:
          requests === 1
            ? [{ type: 'toolCall', id: 'large', name: 'test_tool', arguments: {} }]
            : [{ type: 'text', text: 'done' }],
        stopReason: requests === 1 ? 'toolUse' : 'stop',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
      const stream = createAssistantMessageEventStream()
      stream.push({ type: 'done', reason: requests === 1 ? 'toolUse' : 'stop', message })
      return stream
    },
  })
  const store = new ToolResultStore(directory)
  installPiToolExecutionHarness(
    agent,
    registry,
    new ToolExecutionHarness(
      registry,
      new SandboxService(),
      new FileToolResultRetentionPolicy(store),
    ),
    {},
    () => 'run-1',
  )
  await agent.prompt('run')
  expect(requests).toBe(2)
  expect((await store.load('tool-result://run-1/large')).result.content).toEqual([
    { type: 'text', text },
  ])
})
