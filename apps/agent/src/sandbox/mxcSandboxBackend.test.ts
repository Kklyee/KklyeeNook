import { expect, test, vi } from 'vitest'
import { MxcSandboxBackend, mxcCommandLine, type MxcModule } from './mxcSandboxBackend'
import { resolveShellRuntime } from './shellRuntime'
import type { SandboxExecutionRequest } from './sandboxBackend'

const runtime = resolveShellRuntime({ platform: 'win32', workspaceRoot: 'C:\\project' })

function module(result: Partial<Awaited<ReturnType<MxcModule['run']>>> = {}): MxcModule {
  return {
    getPlatformSupport: () => ({ isSupported: true, reason: '' }),
    run: vi.fn(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      warnings: [],
      ...result,
    })),
  }
}

function request(overrides: Partial<SandboxExecutionRequest> = {}): SandboxExecutionRequest {
  return {
    mode: 'workspace-write',
    command: 'Write-Output hi',
    cwd: 'C:\\project',
    workspaceRoot: 'C:\\project',
    runtime,
    executeDirect: vi.fn(),
    ...overrides,
  }
}

test('reports support from the MXC platform probe and caches it', () => {
  const probe = vi.fn(() => ({ isSupported: true, reason: '' }))
  const backend = new MxcSandboxBackend(() => ({ ...module(), getPlatformSupport: probe }))
  expect(backend.support()).toBe('partial')
  expect(backend.support()).toBe('partial')
  expect(probe).toHaveBeenCalledOnce()
})

test.each([
  [false, 'unavailable'],
  [true, 'partial'],
] as const)('maps platform support %s to %s', (isSupported, support) => {
  const backend = new MxcSandboxBackend(() => ({
    ...module(),
    getPlatformSupport: () => ({ isSupported, reason: 'no' }),
  }))
  expect(backend.support()).toBe(support)
})

test('treats a missing MXC runtime as unavailable without throwing', () => {
  const backend = new MxcSandboxBackend(() => undefined)
  expect(backend.support()).toBe('unavailable')
})

test('encodes PowerShell commands so hostile quoting cannot escape the sandbox', () => {
  const line = mxcCommandLine(runtime, 'Write-Output "a"; Write-Output \'b\'')
  const encoded = line.split(' -EncodedCommand ')[1]
  expect(line).toMatch(/^".*pwsh\.exe" -NoLogo -NoProfile -NonInteractive -Mta -OutputFormat Text -EncodedCommand /)
  expect(line).not.toContain('Write-Output')
  expect(Buffer.from(encoded, 'base64').toString('utf16le')).toContain('Write-Output "a"')
})

test('grants the workspace for writes and reports sandbox details', async () => {
  const mxc = module({ stdout: 'hi\n' })
  const result = await new MxcSandboxBackend(() => mxc).execute(request())
  expect(mxc.run).toHaveBeenCalledWith(
    expect.objectContaining({
      workingDirectory: 'C:\\project',
      filesystem: { readwritePaths: ['C:\\project'], readonlyPaths: ['C:\\'] },
      inheritDefaultEnvironment: true,
    }),
  )
  expect(result.details).toMatchObject({
    exitCode: 0,
    sandbox: { mode: 'workspace-write', backend: 'mxc', enforcement: 'partial' },
  })
})

test('downgrades read-only mode to a read-only filesystem policy', async () => {
  const mxc = module()
  await new MxcSandboxBackend(() => mxc).execute(request({ mode: 'read-only' }))
  expect(mxc.run).toHaveBeenCalledWith(
    expect.objectContaining({ filesystem: { readonlyPaths: ['C:\\project', 'C:\\'] } }),
  )
})

test('rejects full access because restricted execution cannot elevate', async () => {
  await expect(
    new MxcSandboxBackend(() => module()).execute(request({ mode: 'full-access' })),
  ).rejects.toThrow('Restricted execution requires a sandbox mode')
})

test('requires a workspace before launching', async () => {
  await expect(
    new MxcSandboxBackend(() => module()).execute(request({ workspaceRoot: undefined })),
  ).rejects.toThrow('Sandbox execution requires a workspace')
})

test('honors an aborted signal without launching', async () => {
  const mxc = module()
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(
    new MxcSandboxBackend(() => mxc).execute(request({ signal: controller.signal })),
  ).rejects.toThrow('cancelled')
  expect(mxc.run).not.toHaveBeenCalled()
})

test('wraps MXC launch failures as sandbox policy errors', async () => {
  const mxc: MxcModule = {
    getPlatformSupport: () => ({ isSupported: true, reason: '' }),
    run: vi.fn(async () => {
      throw new Error('backend exploded')
    }),
  }
  await expect(new MxcSandboxBackend(() => mxc).execute(request())).rejects.toMatchObject({
    code: 'sandbox_policy_init_failed',
  })
})

test('surfaces a nonzero workload exit code as an error result', async () => {
  const result = await new MxcSandboxBackend(() => module({ exitCode: 7, stderr: 'boom' })).execute(
    request(),
  )
  expect(result.isError).toBe(true)
  expect(result.content[0]).toMatchObject({ type: 'text' })
})