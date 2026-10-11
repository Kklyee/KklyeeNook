import { ToolExecutionHarness } from '../runtime/tool-execution-harness'
import { FileToolResultRetentionPolicy } from '../tools/toolResultRetentionPolicy'
import { ToolResultStore } from '../tools/toolResultStore'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PermissionRequest } from '@kklyeenook/shared/approval/permission'
import { ToolRegistry } from '../tools/toolRegistry'
import { registerBuiltinTools } from '../tools/builtin-tools'
import { SandboxService, toolPermissionResource } from './sandboxService'
import { LinuxSandboxBackend } from './sandboxBackend'

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

test('treats Pi find and grep as workspace-scoped read paths', async () => {
  const sandbox = new SandboxService()
  const findRequest: PermissionRequest = {
    ...request('.'),
    toolName: 'find',
    resource: toolPermissionResource('find', { pattern: '**/*.tsx' }),
  }
  const grepRequest: PermissionRequest = {
    ...request('src'),
    toolName: 'grep',
    resource: toolPermissionResource('grep', { path: 'src', pattern: 'needle' }),
  }

  expect(findRequest.resource).toEqual({ kind: 'path', path: '.', action: 'read' })
  expect(grepRequest.resource).toEqual({ kind: 'path', path: 'src', action: 'read' })
  await expect(sandbox.resolveFile(findRequest)).resolves.toBe(root)
  await expect(
    sandbox.resolveFile({
      ...grepRequest,
      resource: toolPermissionResource('grep', { path: '../project-evil', pattern: 'needle' }),
    }),
  ).rejects.toThrow('工作区外')
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

test('read-only writes require approval, unavailable projects deny local tools, full access requires explicit paths', async () => {
  const sandbox = new SandboxService()
  await expect(sandbox.resolveFile(request('a.txt', 'read-only'))).rejects.toThrow(
    '需要工作区写入权限',
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

test('the harness protects file adapters and consumes one-shot approvals', async () => {
  const sandbox = new SandboxService()
  const registry = new ToolRegistry()
  registerBuiltinTools(registry, '')
  const [rawWrite] = registry.resolve<any>(['write'], { cwd: root })
  const harness = new ToolExecutionHarness(registry, sandbox, new FileToolResultRetentionPolicy(new ToolResultStore(join(directory, 'results'))), async call => call.id === 'once')
  const invoke = (id: string, args: unknown, executionContext?: PermissionRequest) =>
    harness.execute('run', { id, toolName: 'write', args }, { executionContext }, input => rawWrite.execute(id, input))
  await expect(
    invoke('implicit', { path: join(root, 'a.txt'), content: 'denied' }),
  ).resolves.toMatchObject({ error: { code: 'PERMISSION_DENIED' } })
  await expect(invoke('inside', { path: './a.txt', content: 'inside' }, request('a.txt'))).resolves.toMatchObject({ status: 'success' })
  expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('inside')
  const target = join(outside, 'a.txt')
  await expect(invoke('outside', { path: target, content: 'denied' }, request(target))).resolves.toMatchObject({ error: { code: 'PERMISSION_DENIED' } })
  await expect(invoke('once', { path: target, content: 'allowed' }, request(target))).resolves.toMatchObject({ status: 'success' })
  expect(await readFile(target, 'utf8')).toBe('allowed')
  await expect(invoke('next', { path: target, content: 'denied' }, request(target))).resolves.toMatchObject({ error: { code: 'PERMISSION_DENIED' } })
})

test('shell fails closed and executes direct only with full access or one-shot approval', async () => {
  const sandbox = new SandboxService(new LinuxSandboxBackend())
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
  await expect(sandbox.execute(input, execution, 'call')).rejects.toThrow('需要完全权限以运行此命令')
  expect(executeDirect).not.toHaveBeenCalled()
  sandbox.elevate('call', input, 'full-access')
  await sandbox.execute(input, execution, 'call')
  expect(executeDirect).toHaveBeenCalledTimes(1)
  await expect(sandbox.execute(input, execution, 'call')).rejects.toThrow('需要完全权限以运行此命令')
  await sandbox.execute({ ...input, mode: 'full-access' }, execution)
  expect(executeDirect).toHaveBeenCalledTimes(2)
})

