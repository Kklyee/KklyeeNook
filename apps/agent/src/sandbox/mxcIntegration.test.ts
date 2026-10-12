import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { PermissionRequest } from '@kklyeenook/shared/approval/permission'
import { MxcSandboxBackend } from './mxcSandboxBackend'
import { SandboxService } from './sandbox-service'

const require = createRequire(import.meta.url)
const installed = (() => {
  try {
    require.resolve('@microsoft/mxc-sdk/v1')
    return true
  } catch {
    return false
  }
})()

describe.skipIf(process.platform !== 'win32' || !installed)('MXC sandbox integration', () => {
  let directory: string
  let workspace: string
  let outside: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nook-mxc-'))
    workspace = join(directory, 'project')
    outside = join(directory, 'outside')
    await mkdir(workspace)
    await mkdir(outside)
    await writeFile(join(workspace, 'existing.txt'), 'original')
    await writeFile(join(outside, 'existing.txt'), 'outside')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const request = (mode: PermissionRequest['mode']): PermissionRequest => ({
    conversationId: 'chat',
    workspaceId: 'ws',
    workspace: { id: 'ws', rootPath: workspace },
    mode,
    toolName: 'bash',
    resource: { kind: 'command', command: 'Write-Output hi' },
  })

  test('runs a workspace-write command through the real sandbox service', async () => {
    const sandbox = new SandboxService(new MxcSandboxBackend())
    expect(sandbox.policy).toBeDefined()
    const result = await sandbox.execute(request('workspace-write'), {
      command: "Set-Content -Path 'inner.txt' -Value made; Get-Content inner.txt",
      cwd: workspace,
      executeDirect: async () => {
        throw new Error('direct execution must not run')
      },
    })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect((await readFile(join(workspace, 'inner.txt'), 'utf8')).trim()).toBe('made')
    expect(result.details).toMatchObject({ sandbox: { backend: 'mxc', mode: 'workspace-write' } })
  })

  test('denies writes outside the workspace while the workspace stays writable', async () => {
    const sandbox = new SandboxService(new MxcSandboxBackend())
    const script =
      `try { Set-Content -Path '${join(outside, 'evil.txt')}' -Value bad -ErrorAction Stop; 'ESCAPED' }` +
      ` catch { 'DENIED' }`
    const result = await sandbox.execute(request('workspace-write'), {
      command: script,
      cwd: workspace,
      executeDirect: async () => {
        throw new Error('direct execution must not run')
      },
    })
    expect(JSON.stringify(result.content)).toContain('DENIED')
    await expect(readFile(join(outside, 'evil.txt'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(outside, 'existing.txt'), 'utf8')).toBe('outside')
  })
})