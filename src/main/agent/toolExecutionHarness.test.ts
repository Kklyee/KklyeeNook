import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Type } from 'typebox'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import { ToolResultStore } from '@/main/tools/toolResultStore'
import { FileToolResultRetentionPolicy } from '@/main/tools/toolResultRetentionPolicy'
import { SandboxService } from '@/main/sandbox/sandboxService'
import { registerPiBuiltinTools } from './pi/adapters/piBuiltinToolAdapter'
import { registerPiMcpTool } from './pi/adapters/piMcpToolAdapter'
import { registerPiToolResultTool } from './pi/adapters/piToolResultAdapter'
import { ToolExecutionHarness } from './toolExecutionHarness'
import type { ToolResult } from '@/shared/tool/tool'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-tool-contract-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(directory, { recursive: true, force: true })
})

function setup(timeoutMs?: number) {
  const registry = new ToolRegistry()
  registry.register({
    definition: {
      name: 'test_tool',
      label: 'Test',
      description: 'Test',
      inputSchema: Type.Object({ path: Type.String() }),
      timeoutMs,
    },
    adapter: { runtime: 'pi', create: () => ({}) },
  })
  const sandbox = new SandboxService()
  const store = new ToolResultStore(join(directory, 'tool-results'))
  const retention = new FileToolResultRetentionPolicy(store)
  const harness = new ToolExecutionHarness(registry, sandbox, retention)
  const call = { id: 'call-1', toolName: 'test_tool', args: { path: 'a.txt' } }
  return { registry, sandbox, store, retention, harness, call }
}

test.each([{}, { path: 42 }, { path: null }])(
  'invalid arguments %j never reach permission or execution',
  async (args) => {
    const { sandbox, harness, call } = setup()
    const authorize = vi.spyOn(sandbox.policy, 'evaluate')
    const execute = vi.fn()
    const result = await harness.execute('run-1', { ...call, args }, {}, execute)
    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'INVALID_ARGUMENTS' },
      content: [{ type: 'text', text: expect.stringContaining('Invalid tool arguments:') }],
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  },
)

test('unknown tools return UNKNOWN_TOOL', async () => {
  const { harness, call } = setup()
  expect(
    await harness.execute('run-1', { ...call, toolName: 'missing' }, {}, vi.fn()),
  ).toMatchObject({ error: { code: 'UNKNOWN_TOOL' } })
})

test('thrown failures become EXECUTION_ERROR', async () => {
  const { harness, call } = setup()
  expect(
    await harness.execute('run-1', call, {}, async () => {
      throw new Error('broken')
    }),
  ).toMatchObject({ status: 'error', error: { code: 'EXECUTION_ERROR', message: 'broken' } })
})

test('abort settles a tool that ignores its signal', async () => {
  const { harness, call } = setup()
  const controller = new AbortController()
  const started = vi.fn()
  const completion = harness.execute(
    'run-1',
    call,
    {},
    async (_args, signal) => {
      started(signal)
      return new Promise(() => {})
    },
    controller.signal,
  )
  await vi.waitFor(() => expect(started).toHaveBeenCalled())
  controller.abort()
  expect(await completion).toMatchObject({ error: { code: 'ABORTED' } })
  expect(started.mock.calls[0][0].aborted).toBe(true)
})

test('an already aborted signal never starts execution', async () => {
  const { harness, call } = setup()
  const execute = vi.fn()
  expect(await harness.execute('run-1', call, {}, execute, AbortSignal.abort())).toMatchObject({
    error: { code: 'ABORTED' },
  })
  expect(execute).not.toHaveBeenCalled()
})

test('timeout aborts the adapter and returns TIMEOUT', async () => {
  vi.useFakeTimers()
  const { harness, call } = setup(25)
  const started = vi.fn()
  const completion = harness.execute('run-1', call, {}, async (_args, signal) => {
    started(signal)
    return new Promise(() => {})
  })
  await vi.advanceTimersByTimeAsync(25)
  expect(await completion).toMatchObject({ error: { code: 'TIMEOUT' } })
  expect(started.mock.calls[0][0].aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

test('denied permissions become PERMISSION_DENIED before execution', async () => {
  const { harness, call, sandbox } = setup()
  vi.spyOn(sandbox.policy, 'evaluate').mockResolvedValue({ outcome: 'deny', reason: 'denied' })
  const execute = vi.fn()
  expect(await harness.execute('run-1', call, {}, execute)).toMatchObject({
    error: { code: 'PERMISSION_DENIED', message: 'denied' },
  })
  expect(execute).not.toHaveBeenCalled()
})

test('dismissed or rejected approvals become PERMISSION_DENIED', async () => {
  const { registry, sandbox, retention, call } = setup()
  vi.spyOn(sandbox.policy, 'evaluate').mockResolvedValue({
    outcome: 'ask',
    reason: 'approval',
    requestedMode: 'full-access',
  })
  const execute = vi.fn()
  const harness = new ToolExecutionHarness(registry, sandbox, retention, async () => false)
  expect(await harness.execute('run-1', call, {}, execute)).toMatchObject({
    error: { code: 'PERMISSION_DENIED' },
  })
  expect(execute).not.toHaveBeenCalled()
})

test('small results preserve content, image and details without persistence', async () => {
  const { harness, call, store } = setup()
  const save = vi.spyOn(store, 'save')
  const raw = {
    content: [
      { type: 'text', text: 'hello' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
    ],
    details: { count: 1 },
  }
  expect(await harness.execute('run-1', call, {}, async () => raw)).toEqual({
    ...raw,
    status: 'success',
    toolCallId: call.id,
    toolName: call.toolName,
  })
  expect(save).not.toHaveBeenCalled()
})

test('32 KiB is inline and the next byte is retained', async () => {
  const { retention } = setup()
  const result: ToolResult = {
    toolName: 'test_tool',
    toolCallId: 'call-1',
    status: 'success',
    content: [{ type: 'text', text: '' }],
  }
  result.content[0] = {
    type: 'text',
    text: 'x'.repeat(32 * 1024 - Buffer.byteLength(JSON.stringify(result))),
  }
  expect(Buffer.byteLength(JSON.stringify(result))).toBe(32 * 1024)
  expect(await retention.process('run-1', 'call-1', result)).toBe(result)
  result.content[0].text += 'x'
  expect(await retention.process('run-1', 'call-1', result)).toMatchObject({
    retention: { truncated: true },
  })
})

test('large UTF-8 results preserve head and tail and can be read back through read_tool_result', async () => {
  const { registry, harness, call, store } = setup()
  const text = `HEAD\n${'中文🙂'.repeat(12000)}\nTAIL`
  const result = await harness.execute('run-1', call, {}, async () => ({
    content: [{ type: 'text', text }],
    details: { original: true },
  }))
  expect(result.retention).toMatchObject({
    truncated: true,
    resultRef: 'tool-result://run-1/call-1',
  })
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining('HEAD') })
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining('TAIL') })
  expect(JSON.stringify(result)).not.toContain('�')
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(32 * 1024)
  expect(result.details).toBeUndefined()
  const record = await store.load(result.retention!.resultRef!)
  expect(record).toMatchObject({
    runId: 'run-1',
    toolCallId: call.id,
    toolName: call.toolName,
    createdAt: expect.any(Number),
    result: { content: [{ type: 'text', text }] },
  })
  registerPiToolResultTool(registry, store)
  const [read] = registry.resolve<any>('pi', ['read_tool_result'], {})
  let offset = 0
  let full = ''
  while (true) {
    const input = { resultRef: result.retention!.resultRef!, offset, limit: 4097 }
    const page = await harness.execute(
      'run-1',
      { id: `page-${offset}`, toolName: 'read_tool_result', args: input },
      {},
      (args) => read.execute('read', args),
    )
    expect(page.status).toBe('success')
    expect(page.retention).toBeUndefined()
    full += page.content[0].type === 'text' ? page.content[0].text : ''
    const details = page.details as { nextOffset: number; hasMore: boolean }
    offset = details.nextOffset
    if (!details.hasMore) break
  }
  expect(JSON.parse(full)).toEqual(record.result)
})

test('large details and images are also retained and excluded from the preview', async () => {
  const { harness, call, store } = setup()
  const raw = {
    content: [{ type: 'image', data: 'x'.repeat(90000), mimeType: 'image/png' }],
    details: { secret: 'y'.repeat(90000) },
  }
  const result = await harness.execute('run-1', call, {}, async () => raw)
  expect(result.retention?.truncated).toBe(true)
  expect(result.content.every((block) => block.type === 'text')).toBe(true)
  expect(result.details).toBeUndefined()
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(32 * 1024)
  expect((await store.load(result.retention!.resultRef!)).result).toMatchObject(raw)
})

test('MCP validates standard nested JSON Schema and normalizes remote errors and structured content', async () => {
  const { registry, sandbox, retention } = setup()
  const callTool = vi.fn(async () => ({ content: [], structuredContent: { answer: 42 } }))
  registerPiMcpTool(
    registry,
    { id: 'server', name: 'Server', enabled: true, transport: 'stdio', command: 'mcp', args: [] },
    {
      name: 'nested',
      inputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { mode: { enum: ['fast'] } },
              required: ['mode'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
    { callTool },
  )
  const harness = new ToolExecutionHarness(registry, sandbox, retention)
  const context = { executionContext: { conversationId: 'chat', mode: 'full-access' as const } }
  const [tool] = registry.resolve<any>('pi', ['mcp__server__nested'], context)
  const invoke = (args: unknown) =>
    harness.execute('run-1', { id: 'mcp', toolName: tool.name, args }, context, (input) =>
      tool.execute('mcp', input),
    )
  expect(await invoke({ items: [{ mode: 'wrong' }] })).toMatchObject({
    error: { code: 'INVALID_ARGUMENTS' },
  })
  expect(callTool).not.toHaveBeenCalled()
  expect(await invoke({ items: [{ mode: 'fast' }] })).toMatchObject({
    status: 'success',
    content: [{ type: 'text', text: '{"answer":42}' }],
  })
  callTool.mockResolvedValueOnce({
    content: [{ type: 'text', text: 'remote failed' }],
    isError: true,
  } as never)
  expect(await invoke({ items: [{ mode: 'fast' }] })).toMatchObject({
    error: { code: 'EXECUTION_ERROR', message: 'remote failed' },
  })
})

test('built-in read retains the full file before any preview truncation', async () => {
  const { registry, sandbox, retention, store } = setup()
  registerPiBuiltinTools(registry, directory)
  const text = `HEAD\n${'long line\n'.repeat(12000)}TAIL`
  const path = join(directory, 'large.txt')
  await writeFile(path, text)
  const context = {
    cwd: directory,
    executionContext: {
      conversationId: 'chat',
      workspace: { id: 'ws', rootPath: directory },
      mode: 'read-only' as const,
    },
  }
  const [read] = registry.resolve<any>('pi', ['read'], context)
  const harness = new ToolExecutionHarness(registry, sandbox, retention)
  const result = await harness.execute(
    'run-1',
    { id: 'read', toolName: 'read', args: { path: 'large.txt' } },
    context,
    (args) => read.execute('read', args),
  )
  expect(result.retention?.truncated).toBe(true)
  expect((await store.load(result.retention!.resultRef!)).result.content).toEqual([
    { type: 'text', text: await readFile(path, 'utf8') },
  ])
})

test('built-in bash retains full stdout and applies timeout in the harness', async () => {
  const { registry, sandbox, retention, store } = setup()
  registerPiBuiltinTools(registry, directory)
  const context = {
    cwd: directory,
    executionContext: {
      conversationId: 'chat',
      workspace: { id: 'ws', rootPath: directory },
      mode: 'full-access' as const,
    },
  }
  const [bash] = registry.resolve<any>('pi', ['bash'], context)
  const harness = new ToolExecutionHarness(registry, sandbox, retention)
  const text = `HEAD${'0'.repeat(90000)}TAIL`
  const result = await harness.execute(
    'run-1',
    { id: 'bash', toolName: 'bash', args: { command: "printf 'HEAD%090000dTAIL' 0" } },
    context,
    (args, signal) => bash.execute('bash', args, signal),
  )
  expect(result.status, result.error?.message).toBe('success')
  expect(result.retention?.truncated).toBe(true)
  expect((await store.load(result.retention!.resultRef!)).result.content).toEqual([
    { type: 'text', text },
  ])
  let shellExecution: Promise<unknown> | undefined
  const timedOut = await harness.execute(
    'run-1',
    { id: 'timeout', toolName: 'bash', args: { command: 'sleep 3', timeout: 0.1 } },
    context,
    (args, signal) => {
      shellExecution = bash.execute('timeout', args, signal)
      return shellExecution!
    },
  )
  expect(timedOut).toMatchObject({ error: { code: 'TIMEOUT' } })
  await shellExecution?.catch(() => undefined)
}, 20000)

test('escaped control characters cannot produce an oversized retained preview', async () => {
  const { harness, call, store } = setup()
  const text = '\0'.repeat(20000)
  const result = await harness.execute('run-1', call, {}, async () => ({
    content: [{ type: 'text', text }],
  }))
  expect(result.retention?.truncated).toBe(true)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32 * 1024)
  expect((await store.load(result.retention!.resultRef!)).result.content).toEqual([
    { type: 'text', text },
  ])
})

test.each([
  'tool-result://../call',
  'tool-result://run/..',
  'tool-result://run/%2e%2e%2ffile',
  'file:///etc/passwd',
])('rejects unsafe result reference %s', async (resultRef) => {
  const { store } = setup()
  await expect(store.load(resultRef)).rejects.toThrow('Invalid tool result reference')
})
