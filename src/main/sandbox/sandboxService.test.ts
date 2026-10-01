import { runAgentLoop, type AgentEvent } from '@earendil-works/pi-agent-core'
import { createPiApprovalExtension } from '../approval/piApprovalExtension'
import { toPiClientEventBody } from '../agent/pi/client/piClientEventAdapter'
import { resolveToolExecutionStatus } from '@/shared/tool/toolExecutionStatus'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PermissionRequest } from '@/shared/approval/permission'
import { ToolRegistry } from '../tools/toolRegistry'
import { registerPiBuiltinTools } from '../agent/pi/adapters/piBuiltinToolAdapter'
import { SandboxService } from './sandboxService'

let directory: string
let root: string
let outside: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-sandbox-'))
  root = join(directory, 'project')
  outside = join(directory, 'project-evil')
  await mkdir(root)
  await mkdir(outside)
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
function request(
  path: string,
  mode: PermissionRequest['mode'] = 'workspace-write',
): PermissionRequest {
  return {
    conversationId: 'chat',
    workspaceId: 'ws',
    workspace: { id: 'ws', rootPath: root },
    mode,
    toolName: 'write',
    resource: { kind: 'path', path, action: 'write' },
  }
}

test('resolves new nested paths and detects traversal, prefix collisions and junction escapes', async () => {
  const sandbox = new SandboxService()
  expect(await sandbox.paths.resolve('./nested/a.txt', root)).toEqual({
    path: join(root, 'nested', 'a.txt'),
    inside: true,
  })
  expect((await sandbox.paths.resolve('../project-evil/a.txt', root)).inside).toBe(false)
  expect((await sandbox.paths.resolve(join(outside, 'a.txt'), root)).inside).toBe(false)
  await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  expect((await sandbox.paths.resolve('link/new/a.txt', root)).inside).toBe(false)
  await expect(sandbox.resolveFile(request('link/new/a.txt'))).rejects.toThrow('工作区外')
})

test('one-shot elevation is tied to the call and exact resource and is consumed once', async () => {
  const sandbox = new SandboxService()
  const input = request(join(outside, 'a.txt'))
  sandbox.elevate('call-1', input, 'full-access')
  await expect(sandbox.resolveFile(input, 'call-2')).rejects.toThrow('工作区外')
  await expect(sandbox.resolveFile(request(join(outside, 'b.txt')), 'call-1')).rejects.toThrow(
    '工作区外',
  )
  expect(await sandbox.resolveFile(input, 'call-1')).toBe(join(outside, 'a.txt'))
  await expect(sandbox.resolveFile(input, 'call-1')).rejects.toThrow('工作区外')
})

test('read-only denies writes, unavailable projects deny local tools, full access requires explicit paths', async () => {
  const sandbox = new SandboxService()
  await expect(sandbox.resolveFile(request('a.txt', 'read-only'))).rejects.toThrow(
    '需要本次提升为工作区写入权限',
  )
  const ungrouped = {
    ...request(join(outside, 'a.txt'), 'read-only'),
    workspace: undefined,
    workspaceId: undefined,
  }
  await expect(sandbox.resolveFile(ungrouped)).rejects.toThrow('关联')
  expect(await sandbox.resolveFile({ ...ungrouped, mode: 'full-access' })).toBe(
    join(outside, 'a.txt'),
  )
  await expect(
    sandbox.resolveFile({
      ...ungrouped,
      mode: 'full-access',
      resource: { kind: 'path', action: 'read', path: './a.txt' },
    }),
  ).rejects.toThrow('绝对路径')
})

test('protected file adapters cannot write outside the workspace without elevation', async () => {
  const sandbox = new SandboxService()
  const registry = new ToolRegistry()
  registerPiBuiltinTools(registry, '', sandbox)
  const [unscopedWrite] = registry.resolve<any>('pi', ['write'], { cwd: root })
  await expect(
    unscopedWrite.execute('implicit', { path: join(root, 'a.txt'), content: 'denied' }),
  ).rejects.toThrow('关联')
  const [write] = registry.resolve<any>('pi', ['write'], { executionContext: request('a.txt') })
  await write.execute('inside', { path: './a.txt', content: 'inside' })
  expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('inside')
  const target = join(outside, 'a.txt')
  await expect(write.execute('outside', { path: target, content: 'denied' })).rejects.toThrow(
    '工作区外',
  )
  sandbox.elevate('once', request(target), 'full-access')
  await write.execute('once', { path: target, content: 'allowed' })
  expect(await readFile(target, 'utf8')).toBe('allowed')
  await expect(write.execute('next', { path: target, content: 'denied' })).rejects.toThrow(
    '工作区外',
  )
})

test('shell fails closed and executes direct only with full access or one-shot approval', async () => {
  const sandbox = new SandboxService()
  const input: PermissionRequest = {
    ...request(''),
    toolName: 'bash',
    resource: { kind: 'command', command: 'npm install' },
  }
  const executeDirect = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: 'done' }],
    details: {},
  }))
  const execution = { command: 'npm install', cwd: root, executeDirect }
  await expect(sandbox.execute(input, execution, 'call')).rejects.toThrow('无法保证')
  expect(executeDirect).not.toHaveBeenCalled()
  sandbox.elevate('call', input, 'full-access')
  await sandbox.execute(input, execution, 'call')
  expect(executeDirect).toHaveBeenCalledTimes(1)
  await expect(sandbox.execute(input, execution, 'call')).rejects.toThrow('无法保证')
  await sandbox.execute({ ...input, mode: 'full-access' }, execution)
  expect(executeDirect).toHaveBeenCalledTimes(2)
})

test('read-only write pauses for approval, then retries once through the real agent loop', async () => {
  const sandbox = new SandboxService()
  const registry = new ToolRegistry()
  registerPiBuiltinTools(registry, '', sandbox)
  const context = request('blocked.txt', 'read-only')
  const [write] = registry.resolve<any>('pi', ['write'], { executionContext: context })
  const execute = vi.spyOn(write, 'execute')
  let handler: ((event: any, context: any) => Promise<unknown>) | undefined
  const emitApproval = vi.fn()
  const selection = '允许本次使用工作区写入权限'
  const select = vi.fn(async () => selection)
  createPiApprovalExtension(
    context,
    sandbox,
    emitApproval,
  )({
    on: (name: string, callback: typeof handler) => {
      if (name === 'tool_call') handler = callback
    },
  } as never)
  const message = {
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: 'denied',
        name: 'write',
        arguments: { path: 'blocked.txt', content: 'test' },
      },
    ],
    api: 'openai-completions',
    provider: 'test',
    model: 'test',
    stopReason: 'toolUse',
    timestamp: 1,
  }
  const events: AgentEvent[] = []
  const ui = { select }
  await runAgentLoop(
    [],
    { systemPrompt: '', messages: [], tools: [write] },
    {
      model: { provider: 'test' } as never,
      convertToLlm: (messages) => messages as never,
      beforeToolCall: ({ toolCall, args }) =>
        handler!(
          { toolName: toolCall.name, toolCallId: toolCall.id, input: args },
          { ui },
        ) as never,
      shouldStopAfterTurn: () => true,
    },
    (event) => {
      events.push(event)
    },
    undefined,
    (() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'done', reason: 'toolUse', message }
      },
      result: async () => message,
    })) as never,
  )
  expect(select).toHaveBeenCalledWith(expect.stringContaining('工作区写入权限'), [
    selection,
    '拒绝',
  ])
  expect(emitApproval).toHaveBeenCalledWith(expect.objectContaining({ type: 'approval_required' }))
  expect(execute).toHaveBeenCalledOnce()
  expect(await readFile(join(root, 'blocked.txt'), 'utf8')).toBe('test')
  const end = events.find((event) => event.type === 'tool_execution_end')
  expect(end).toMatchObject({ isError: false })
  const projected = toPiClientEventBody(end as never, 0)
  expect(projected).toMatchObject({ type: 'tool_execution_end', isError: false })
  expect(
    resolveToolExecutionStatus(
      { type: 'complete' },
      end?.type === 'tool_execution_end' ? end.isError : true,
      '仅可查看模式禁止修改文件',
    ).type,
  ).toBe('complete')
  await expect(write.execute('denied', { path: 'blocked.txt', content: 'twice' })).rejects.toThrow(
    '需要本次提升为工作区写入权限',
  )
})
