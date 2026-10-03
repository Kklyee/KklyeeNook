import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { launchShellProcess } from './processLauncher'
import { resolveShellRuntime, shellExecutable, shellRuntimeContext } from './shellRuntime'

test('Windows resolves only PowerShell 7 with a native cwd and no sandbox policy', () => {
  const runtime = resolveShellRuntime({ platform: 'win32', workspaceRoot: 'D:\\repo\\demo' })
  expect(runtime).toMatchObject({
    kind: 'powershell',
    executable: 'pwsh.exe',
    baseArgs: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-Command'],
    cwd: 'D:\\repo\\demo',
  })
  expect(runtime).not.toHaveProperty('mode')
  expect(runtime).not.toHaveProperty('policy')
  expect(runtime.executable).not.toContain('bash')
})

test('missing PowerShell fails explicitly without using another shell', () => {
  expect(() =>
    shellExecutable(
      resolveShellRuntime({ platform: 'win32', workspaceRoot: 'D:\\repo', env: { PATH: '' } }),
    ),
  ).toThrow(expect.objectContaining({ code: 'shell_runtime_unavailable' }))
})

test.skipIf(process.platform !== 'win32')(
  'launcher sets native cwd, preserves quoting, UTF-8, stderr and command exit codes',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'nook-shell-'))
    const cwd = join(root, '项目 空格')
    await mkdir(cwd)
    try {
      await writeFile(join(cwd, '测试.txt'), '中文')
      const runtime = resolveShellRuntime({ workspaceRoot: cwd })
      expect(shellRuntimeContext(cwd)).toContain(
        `Platform: Windows\nShell: PowerShell 7\nWorking directory: ${cwd}`,
      )
      const location = await launchShellProcess(runtime, '(Get-Location).Path')
      expect(location.details).toMatchObject({ stdout: `${cwd}\r\n`, exitCode: 0 })
      const listing = await launchShellProcess(
        runtime,
        '(Get-ChildItem).Name; Write-Output \'中文 "引号" C:\\路径\\\'; [Console]::Error.WriteLine("中文错误")',
      )
      expect(listing.details).toMatchObject({
        stdout: expect.stringContaining('测试.txt'),
        stderr: '中文错误\r\n',
        exitCode: 0,
      })
      expect((listing.details as { stdout: string }).stdout).toContain('中文 "引号" C:\\路径\\')
      expect(await launchShellProcess(runtime, 'node -e "process.exit(7)"')).toMatchObject({
        details: { exitCode: 7 },
        isError: true,
      })
      expect(await launchShellProcess(runtime, 'node -e "process.exit(125)"')).toMatchObject({
        details: { exitCode: 125 },
        isError: true,
      })
      expect(await launchShellProcess(runtime, 'Get-Item missing-file')).toMatchObject({
        details: { exitCode: 1 },
        isError: true,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  30000,
)
