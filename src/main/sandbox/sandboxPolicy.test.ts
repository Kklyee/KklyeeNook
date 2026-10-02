import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PermissionRequest } from '@/shared/approval/permission'
import { ToolExecutionHarness } from '@/main/agent/toolExecutionHarness'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import { registerPiBuiltinTools } from '@/main/agent/pi/adapters/piBuiltinToolAdapter'
import { ToolExecutionError } from '@/shared/tool/toolExecutionResult'
import { SandboxService } from './sandboxService'
import {
  DirectExecutionBackend,
  LinuxSandboxBackend,
  MacSandboxBackend,
  type SandboxSupport,
} from './sandboxBackend'

let directory: string
let root: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-sandbox-policy-'))
  root = join(directory, 'workspace')
  await mkdir(root)
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function request(mode: PermissionRequest['mode'] = 'workspace-write'): PermissionRequest {
  return {
    conversationId: 'chat',
    workspaceId: 'ws',
    workspace: { id: 'ws', rootPath: root },
    mode,
    toolName: 'bash',
    resource: { kind: 'command', command: 'npm test' },
  }
}

test.each(['full', 'partial'] as SandboxSupport[])(
  '%s support authorizes and routes both restricted modes to the backend',
  async (support) => {
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'sandboxed' }],
      details: {},
    }))
    const sandbox = new SandboxService({ support: () => support, execute })
    const executeDirect = vi.fn()
    for (const mode of ['workspace-write', 'read-only'] as const) {
      expect(await sandbox.policy.evaluate(request(mode))).toEqual({ outcome: 'allow' })
      await sandbox.execute(request(mode), {
        command: 'npm test',
        cwd: root,
        runId: 'run',
        executeDirect,
      })
      expect(execute).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode, workspaceRoot: root, cwd: root, runId: 'run' }),
      )
    }
    expect(executeDirect).not.toHaveBeenCalled()
  },
)

test.each([new LinuxSandboxBackend(), new MacSandboxBackend()])(
  'unavailable backends require explicit full access',
  async (backend) => {
    const sandbox = new SandboxService(backend)
    expect(await sandbox.policy.evaluate(request())).toMatchObject({
      outcome: 'ask',
      requestedMode: 'full-access',
    })
    await expect(
      backend.execute({ command: 'npm test', mode: 'workspace-write', executeDirect: vi.fn() }),
    ).rejects.toThrow('不可用')
  },
)

test('full access and exact one-shot elevation select direct execution once', async () => {
  const execute = vi.fn()
  const sandbox = new SandboxService({ support: () => 'unavailable', execute })
  const executeDirect = vi.fn(async () => ({ content: [], details: {} }))
  const input = request()
  const execution = { command: 'npm test', cwd: root, executeDirect }
  sandbox.elevate('call', input, 'full-access')
  await expect(sandbox.execute(input, execution, 'other')).rejects.toMatchObject({
    code: 'PERMISSION_DENIED',
  })
  await expect(
    sandbox.execute(
      { ...input, resource: { kind: 'command', command: 'npm install' } },
      execution,
      'call',
    ),
  ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  await sandbox.execute(input, execution, 'call')
  await expect(sandbox.execute(input, execution, 'call')).rejects.toMatchObject({
    code: 'PERMISSION_DENIED',
  })
  await sandbox.execute(request('full-access'), execution)
  expect(executeDirect).toHaveBeenCalledTimes(2)
  expect(execute).not.toHaveBeenCalled()
  expect(() => new DirectExecutionBackend().execute({ ...execution, mode: 'read-only' })).toThrow(
    'full access',
  )
})

test('sandbox startup failure is a normal tool error and never invokes the adapter or approval', async () => {
  const backend = {
    support: () => 'partial' as const,
    execute: vi.fn(async () => {
      throw new Error('Failed to start sandboxed process')
    }),
  }
  const registry = new ToolRegistry()
  registerPiBuiltinTools(registry, root)
  const approve = vi.fn()
  const adapter = vi.fn()
  const harness = new ToolExecutionHarness(
    registry,
    new SandboxService(backend),
    { process: async (_run, _call, result) => result },
    approve,
  )
  const result = await harness.execute(
    'run',
    { id: 'call', toolName: 'bash', args: { command: 'npm test' } },
    { executionContext: request() },
    adapter,
  )
  expect(result).toMatchObject({
    status: 'error',
    error: { code: 'EXECUTION_ERROR', message: 'Failed to start sandboxed process' },
  })
  expect(backend.execute).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceRoot: root, mode: 'workspace-write', runId: 'run' }),
  )
  expect(adapter).not.toHaveBeenCalled()
  expect(approve).not.toHaveBeenCalled()
})

test.each(['ABORTED', 'TIMEOUT', 'PERMISSION_DENIED'] as const)(
  'sandbox %s retains the tool error code',
  async (code) => {
    const registry = new ToolRegistry()
    registerPiBuiltinTools(registry, root)
    const sandbox = new SandboxService({
      support: () => 'partial',
      execute: async () => {
        throw new ToolExecutionError(code, code)
      },
    })
    const harness = new ToolExecutionHarness(registry, sandbox, {
      process: async (_run, _call, result) => result,
    })
    expect(
      await harness.execute(
        'run',
        { id: 'call', toolName: 'bash', args: { command: 'npm test' } },
        { executionContext: request() },
        vi.fn(),
      ),
    ).toMatchObject({ status: 'error', error: { code } })
  },
)
