import { spawnSync } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
  symlink,
  link,
  readdir,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WindowsSandboxBackend } from './windowsSandboxBackend'
import type { SandboxExecutionRequest } from './sandboxBackend'
import { SandboxService } from './sandboxService'
import { ToolExecutionHarness } from '@/main/agent/toolExecutionHarness'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import { registerPiBuiltinTools } from '@/main/agent/pi/adapters/piBuiltinToolAdapter'

describe.skipIf(process.platform !== 'win32')('Windows filesystem sandbox', () => {
  let directory: string
  let workspace: string
  let outside: string
  let backend: WindowsSandboxBackend
  const executeDirect = vi.fn()
  const quote = (path: string) => `"${path}"`
  const remove = (path: string) =>
    `node -e "require('node:fs').unlinkSync(process.argv[1])" ${quote(path)}`

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nook-windows-sandbox-'))
    workspace = join(directory, 'project 中文')
    outside = join(directory, 'outside')
    await mkdir(workspace)
    await mkdir(outside)
    await writeFile(join(workspace, 'existing.txt'), 'original')
    await writeFile(join(outside, 'existing.txt'), 'outside')
    backend = new WindowsSandboxBackend(join(directory, 'data'))
    executeDirect.mockReset()
  })

  afterEach(async () => {
    expect(executeDirect).not.toHaveBeenCalled()
    await backend.finishRun('run')
    await rm(directory, { recursive: true, force: true })
  })

  const execute = (command: string, options: Partial<SandboxExecutionRequest> = {}) =>
    backend.execute({
      mode: 'workspace-write',
      command,
      cwd: workspace,
      workspaceRoot: workspace,
      runId: 'run',
      executeDirect,
      ...options,
    })

  test('a successful real process probe reports partial support', () => {
    expect(backend.support()).toBe('partial')
    expect(backend.support()).toBe('partial')
  })

  test('workspace-write bash runs through the harness without full-access approval', async () => {
    const registry = new ToolRegistry()
    registerPiBuiltinTools(registry, workspace)
    const approve = vi.fn()
    const harness = new ToolExecutionHarness(
      registry,
      new SandboxService(backend),
      { process: async (_run, _call, result) => result },
      approve,
    )
    const result = await harness.execute(
      'run',
      { id: 'call', toolName: 'bash', args: { command: 'echo sandbox > started.txt' } },
      {
        executionContext: {
          conversationId: 'chat',
          workspaceId: 'ws',
          workspace: { id: 'ws', rootPath: workspace },
          mode: 'workspace-write',
        },
      },
      executeDirect,
    )
    expect(result).toMatchObject({
      status: 'success',
      details: { sandbox: { mode: 'workspace-write', enforcement: 'partial' } },
    })
    expect(await readFile(join(workspace, 'started.txt'), 'utf8')).toContain('sandbox')
    expect(approve).not.toHaveBeenCalled()
  }, 30000)

  test('workspace create, write, delete and private temp write succeed with sandbox metadata', async () => {
    const result = await execute(
      'echo created > new.txt && echo changed > existing.txt && mkdir nested && echo temp > "%TEMP%\\private.txt" && echo temp > "%TEMP%\\delete.txt" && del "%TEMP%\\delete.txt" && mkdir "%TEMP%\\nested" && rmdir "%TEMP%\\nested" && type "%TEMP%\\private.txt" && del new.txt && rmdir nested',
    )
    expect(result, JSON.stringify(result)).toMatchObject({
      isError: false,
      details: {
        exitCode: 0,
        sandbox: { mode: 'workspace-write', backend: 'windows-acl', enforcement: 'partial' },
      },
    })
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('temp') }])
    expect(await readFile(join(workspace, 'existing.txt'), 'utf8')).toContain('changed')
    await expect(access(join(workspace, 'new.txt'))).rejects.toThrow()
    expect((await execute('type "%TEMP%\\private.txt"')).isError).toBe(false)
    await backend.finishRun('run')
    expect(await readdir(join(directory, 'data', 'sandbox'))).toEqual([])
  }, 30000)

  test('private temp is isolated between runs and cleared at run completion', async () => {
    expect((await execute('echo first > "%TEMP%\\run.txt"')).isError).toBe(false)
    expect((await execute('type "%TEMP%\\run.txt"', { runId: 'second' })).isError).toBe(true)
    expect((await execute('type "%TEMP%\\run.txt"')).content).toEqual([
      { type: 'text', text: expect.stringContaining('first') },
    ])
    await backend.finishRun('second')
    await backend.finishRun('run')
    expect(await readdir(join(directory, 'data', 'sandbox'))).toEqual([])
  }, 30000)

  test('outside reads succeed while writes, deletes and junction escapes fail', async () => {
    await symlink(outside, join(workspace, 'junction'), 'junction')
    expect((await execute(`type ${quote(join(outside, 'existing.txt'))}`)).isError).toBe(false)
    for (const command of [
      `echo escaped > ${quote(join(outside, 'new.txt'))}`,
      remove(join(outside, 'existing.txt')),
      'echo escaped > "..\\outside\\relative.txt"',
      'echo escaped > "..\\outside\\existing.txt"',
      'echo escaped > junction\\escaped.txt',
      remove('junction\\existing.txt'),
    ])
      expect((await execute(command)).isError).toBe(true)
    expect(await readFile(join(outside, 'existing.txt'), 'utf8')).toBe('outside')
    await expect(access(join(outside, 'new.txt'))).rejects.toThrow()
    await expect(access(join(outside, 'escaped.txt'))).rejects.toThrow()
    await expect(access(join(outside, 'relative.txt'))).rejects.toThrow()
  }, 30000)

  test('file and directory symlinks cannot grant writes or deletes outside', async ({ skip }) => {
    try {
      await symlink(join(outside, 'existing.txt'), join(workspace, 'file-link.txt'), 'file')
      await symlink(outside, join(workspace, 'directory-link'), 'dir')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM')
        skip('Creating symbolic links requires Developer Mode or SeCreateSymbolicLinkPrivilege')
      throw error
    }
    for (const command of [
      'echo escaped > file-link.txt',
      remove('file-link.txt'),
      'echo escaped > directory-link\\new.txt',
      remove('directory-link\\existing.txt'),
    ]) {
      const result = await execute(command)
      expect(result.isError, JSON.stringify(result)).toBe(true)
    }
    expect(await readFile(join(outside, 'existing.txt'), 'utf8')).toBe('outside')
    await expect(access(join(outside, 'new.txt'))).rejects.toThrow()
  }, 30000)

  test('read-only reads workspace but grants no writable root', async () => {
    expect((await execute('type existing.txt', { mode: 'read-only' })).isError).toBe(false)
    expect((await execute('echo created > new.txt', { mode: 'read-only' })).isError).toBe(true)
    expect(
      (await execute('echo temp > "%TEMP%\\private.txt"', { mode: 'read-only' })).isError,
    ).toBe(true)
    expect((await execute('echo changed > existing.txt', { mode: 'read-only' })).isError).toBe(true)
    expect((await execute(remove('existing.txt'), { mode: 'read-only' })).isError).toBe(true)
    expect(await readFile(join(workspace, 'existing.txt'), 'utf8')).toBe('original')
  }, 30000)

  test('low integrity outside files remain protected even with Everyone write access', async () => {
    const target = join(outside, 'existing.txt')
    for (const args of [
      [target, '/grant:r', '*S-1-1-0:(F)'],
      [target, '/setintegritylevel', 'L'],
    ]) {
      const preparation = spawnSync('icacls.exe', args, { encoding: 'utf8', windowsHide: true })
      expect(preparation.status, preparation.stderr).toBe(0)
    }
    expect((await execute(`echo escaped > ${quote(target)}`)).isError).toBe(true)
    expect((await execute(`icacls.exe ${quote(target)} /grant *S-1-5-21-1-2-3-4:F`)).isError).toBe(
      true,
    )
    expect(await readFile(target, 'utf8')).toBe('outside')
  }, 30000)

  test('read-only supports NUL redirection and piped searches without workspace writes', async () => {
    await writeFile(join(workspace, 'existing.txt'), 'sandbox fixture')
    for (const command of [
      'echo ignored >nul',
      'echo ignored 2>nul',
      'findstr /i sandbox existing.txt 2>nul',
      'findstr /i sandbox existing.txt 2>nul | findstr /v missing',
    ]) {
      const result = await execute(command, { mode: 'read-only' })
      expect(result.isError, JSON.stringify(result)).toBe(false)
    }
    expect(await readFile(join(workspace, 'existing.txt'), 'utf8')).toBe('sandbox fixture')
    expect(await readdir(workspace)).toEqual(['existing.txt'])
  }, 30000)

  test('directory grants close the ambient parent-delete channel', async () => {
    const target = join(workspace, 'existing.txt')
    const preparation = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$path = '" +
          target.replaceAll("'", "''") +
          "'; $acl = [IO.File]::GetAccessControl($path); $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.Sddl); $ace = [Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::None, [Security.AccessControl.AceQualifier]::AccessDenied, 0x10000, [Security.Principal.SecurityIdentifier]::new('S-1-1-0'), $false, $null); $raw.DiscretionaryAcl.InsertAce(0, $ace); $acl.SetSecurityDescriptorSddlForm($raw.GetSddlForm([Security.AccessControl.AccessControlSections]::Access), [Security.AccessControl.AccessControlSections]::Access); [IO.File]::SetAccessControl($path, $acl)",
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    expect(preparation.status, preparation.stderr).toBe(0)
    try {
      const deletion = await execute(remove(target))
      expect(deletion.isError, JSON.stringify(deletion)).toBe(true)
      expect(await readFile(target, 'utf8')).toBe('original')
    } finally {
      const cleanup = spawnSync('icacls.exe', [target, '/remove:d', '*S-1-1-0'], {
        encoding: 'utf8',
        windowsHide: true,
      })
      expect(cleanup.status, cleanup.stderr).toBe(0)
    }
  }, 30000)

  test('read-only supports system cryptography while npm workspace writes remain denied', async () => {
    const crypto = await execute(
      'node -e "console.log(require(\'node:crypto\').randomBytes(32).length)"',
      { mode: 'read-only' },
    )
    expect(crypto.isError, JSON.stringify(crypto)).toBe(false)
    await writeFile(
      join(workspace, 'package.json'),
      JSON.stringify({
        scripts: { test: "node -e \"require('node:fs').writeFileSync('denied.txt', 'x')\"" },
      }),
    )
    expect((await execute('npm test', { mode: 'read-only' })).isError).toBe(true)
    await expect(access(join(workspace, 'denied.txt'))).rejects.toThrow()
  }, 30000)

  test.each([
    ['cmd', 'cmd.exe /d /c "echo cmd>cmd.txt"', 'cmd.txt'],
    ['node', 'node script.js', 'node.txt'],
    ['npm', 'npm test', 'node.txt'],
    ['pnpm', 'pnpm build', 'node.txt'],
    ['Python', `${quote(process.env.SANDBOX_TEST_PYTHON ?? 'python')} script.py`, 'python.txt'],
    ['git', 'git init && git status', '.git'],
  ])(
    '%s runs inside the workspace',
    async (_name, command, output) => {
      await writeFile(
        join(workspace, 'script.js'),
        "require('node:fs').writeFileSync('node.txt', 'node')",
      )
      await writeFile(
        join(workspace, 'script.py'),
        "from pathlib import Path\nPath('python.txt').write_text('python')\n",
      )
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          name: 'sandbox-fixture',
          version: '1.0.0',
          scripts: { test: 'node script.js', build: 'node script.js' },
        }),
      )
      const result = await execute(command)
      expect(result.isError, `${command}: ${JSON.stringify(result)}`).toBe(false)
      await access(join(workspace, output))
    },
    60000,
  )

  test('PowerShell reports supported execution or a confined initialization error', async () => {
    const host = quote(process.env.SANDBOX_TEST_POWERSHELL ?? 'powershell.exe')
    const result = await execute(
      host +
        " -NoProfile -NonInteractive -Command \"[IO.File]::WriteAllText('powershell.txt', 'powershell')\"",
    )
    expect(result.details).toMatchObject({
      sandbox: { mode: 'workspace-write', backend: 'windows-acl', enforcement: 'partial' },
    })
    if (result.isError) {
      const text = result.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text.replaceAll('\0', ''))
        .join('\n')
      expect(text).toMatch(/Starting the CLR failed|Unhandled exception/)
      await expect(access(join(workspace, 'powershell.txt'))).rejects.toThrow()
    } else {
      expect(await readFile(join(workspace, 'powershell.txt'), 'utf8')).toBe('powershell')
    }
  }, 30000)

  test('child and grandchild processes inherit the boundary', async () => {
    await writeFile(
      join(workspace, 'child.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(join(outside, 'child.txt'))}, 'escaped')`,
    )
    await writeFile(
      join(workspace, 'parent.js'),
      "const { spawnSync } = require('node:child_process'); process.exit(spawnSync(process.execPath, ['child.js'], { stdio: 'inherit' }).status)",
    )
    const result = await execute('node parent.js')
    expect(result.isError).toBe(true)
    await expect(access(join(outside, 'child.txt'))).rejects.toThrow()
  }, 30000)

  test.each([
    ['node', 'node parent.js'],
    ['npm', 'npm test'],
    ['pnpm', 'pnpm build'],
    ['Python', '"' + (process.env.SANDBOX_TEST_PYTHON ?? 'python') + '" parent.py'],
  ])(
    '%s descendants cannot write or delete outside',
    async (_name, command) => {
      const target = JSON.stringify(join(outside, 'existing.txt'))
      const created = JSON.stringify(join(outside, 'child.txt'))
      await writeFile(
        join(workspace, 'boundary.js'),
        "const fs = require('node:fs'); for (const op of [() => fs.writeFileSync(" +
          created +
          ", 'escaped'), () => fs.writeFileSync(" +
          target +
          ", 'escaped'), () => fs.unlinkSync(" +
          target +
          ")]) { try { op(); process.exit(1) } catch (error) { if (!['EACCES', 'EPERM'].includes(error.code)) throw error } } fs.writeFileSync('checked.txt', 'checked')",
      )
      await writeFile(
        join(workspace, 'parent.js'),
        "const { spawnSync } = require('node:child_process'); process.exit(spawnSync(process.execPath, ['boundary.js'], { stdio: 'inherit' }).status)",
      )
      await writeFile(
        join(workspace, 'package.json'),
        JSON.stringify({
          name: 'sandbox-boundary-fixture',
          version: '1.0.0',
          scripts: { test: 'node parent.js', build: 'node parent.js' },
        }),
      )
      await writeFile(
        join(workspace, 'boundary.py'),
        'from pathlib import Path\n' +
          'for op in [lambda: Path(' +
          created +
          ').write_text("escaped"), lambda: Path(' +
          target +
          ').write_text("escaped"), lambda: Path(' +
          target +
          ').unlink()]:\n' +
          '    try:\n        op()\n    except PermissionError:\n        pass\n' +
          '    else:\n        raise RuntimeError("outside operation succeeded")\n' +
          'Path("checked.txt").write_text("checked")\n',
      )
      await writeFile(
        join(workspace, 'parent.py'),
        'import subprocess, sys\nsys.exit(subprocess.run([sys.executable, "boundary.py"]).returncode)\n',
      )
      const result = await execute(command)
      expect(result.isError, JSON.stringify(result)).toBe(false)
      expect(await readFile(join(workspace, 'checked.txt'), 'utf8')).toBe('checked')
      expect(await readFile(join(outside, 'existing.txt'), 'utf8')).toBe('outside')
      await expect(access(join(outside, 'child.txt'))).rejects.toThrow()
    },
    60000,
  )

  test('hard-linked files stay readable without granting writes to the external inode', async () => {
    await link(join(outside, 'existing.txt'), join(workspace, 'hardlink.txt'))
    expect((await execute('type hardlink.txt')).isError).toBe(false)
    expect((await execute('echo escaped > hardlink.txt')).isError).toBe(true)
    expect(await readFile(join(outside, 'existing.txt'), 'utf8')).toBe('outside')
  }, 30000)

  test('initialization failures never call direct execution', async () => {
    backend = new WindowsSandboxBackend(join(directory, 'data'), join(directory, 'missing.exe'))
    await expect(execute('echo escaped')).rejects.toMatchObject({ code: 'EXECUTION_ERROR' })
    backend = new WindowsSandboxBackend(join(directory, 'data'))
    await expect(
      execute('echo escaped', { workspaceRoot: join(directory, 'missing') }),
    ).rejects.toMatchObject({ code: 'EXECUTION_ERROR' })
    await writeFile(join(directory, 'data-file'), '')
    backend = new WindowsSandboxBackend(join(directory, 'data-file'))
    await expect(execute('echo escaped')).rejects.toMatchObject({ code: 'EXECUTION_ERROR' })
  })

  test('an ACL initialization failure restores earlier grants and never starts the command', async () => {
    const target = join(workspace, 'existing.txt')
    const permissions = spawnSync(
      'icacls.exe',
      [target, '/inheritance:r', '/grant:r', (process.env.USERNAME ?? 'kk') + ':(M)'],
      { encoding: 'utf8', windowsHide: true },
    )
    expect(permissions.status, permissions.stderr).toBe(0)
    const before = spawnSync('icacls.exe', [workspace], { encoding: 'utf8', windowsHide: true })
    expect(before.status, before.stderr).toBe(0)
    await expect(execute('echo started > started.txt')).rejects.toMatchObject({
      code: 'EXECUTION_ERROR',
      message: expect.stringContaining('ACL open'),
    })
    await expect(access(join(workspace, 'started.txt'))).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('original')
    const after = spawnSync('icacls.exe', [workspace], { encoding: 'utf8', windowsHide: true })
    expect(after.status, after.stderr).toBe(0)
    expect(after.stdout).toBe(before.stdout)
  })

  test('cancellation terminates the process tree and restores workspace ACLs', async () => {
    const controller = new AbortController()
    const execution = execute('echo ready > ready.txt && node -e "setInterval(() => {}, 1000)"', {
      signal: controller.signal,
    })
    await vi.waitFor(
      async () => {
        await access(join(workspace, 'ready.txt'))
      },
      { timeout: 15000 },
    )
    controller.abort(new Error('cancelled'))
    await expect(execution).rejects.toThrow('cancelled')
    await writeFile(join(workspace, 'existing.txt'), 'after cancellation')
    await backend.finishRun('run')
    expect(await readdir(join(directory, 'data', 'sandbox'))).toEqual([])
  }, 30000)

  test('ACLs and integrity labels on existing objects are restored after execution', async () => {
    const existing = join(workspace, 'existing.txt')
    const protectedAcl = spawnSync('icacls.exe', [existing, '/inheritance:d'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    expect(protectedAcl.status, protectedAcl.stderr).toBe(0)
    const security = () => {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "[IO.Directory]::GetAccessControl('" +
            workspace.replaceAll("'", "''") +
            "').Sddl; [IO.File]::GetAccessControl('" +
            existing.replaceAll("'", "''") +
            "').Sddl",
        ],
        { encoding: 'utf8', windowsHide: true },
      )
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim().split(/\r?\n/)).toHaveLength(2)
      return result.stdout.trim()
    }
    const before = security()
    const labels = () =>
      [workspace, existing].map((path) =>
        spawnSync('icacls.exe', [path], { encoding: 'utf8', windowsHide: true }).stdout.trim(),
      )
    const beforeLabels = labels()
    expect((await execute('echo done')).isError).toBe(false)
    expect(security()).toBe(before)
    expect(labels()).toEqual(beforeLabels)
  }, 30000)
})
