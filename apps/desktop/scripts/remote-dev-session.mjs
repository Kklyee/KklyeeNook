import { execFile } from 'node:child_process'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

export async function beginRemoteDevSession(root) {
  if (process.platform !== 'win32' || !process.env.APPDATA) return async () => {}
  const directory = join(process.env.APPDATA, 'kklyeenook', 'remote-supervisor')
  let state
  try {
    state = JSON.parse(
      await readFile(join(directory, 'status.json'), 'utf8').then((text) =>
        text.replace(/^\uFEFF/, ''),
      ),
    )
  } catch (error) {
    if (error.code === 'ENOENT') return async () => {}
    throw error
  }
  if (!state.supportsDevSession) {
    throw new Error(
      'The Remote supervisor must be updated or stopped before development can take over.',
    )
  }
  const leasePath = join(directory, 'dev-session.json')
  try {
    const lease = JSON.parse(await readFile(leasePath, 'utf8'))
    if (lease.pid !== process.pid) {
      try {
        process.kill(lease.pid, 0)
        throw new Error(
          'Another development session is already running. Stop it before running pnpm dev again.',
        )
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const release = async () => {
    try {
      const lease = JSON.parse(await readFile(leasePath, 'utf8'))
      if (lease.pid === process.pid) await unlink(leasePath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  await writeFile(leasePath, JSON.stringify({ pid: process.pid, createdAt: Date.now() }))
  try {
    if (state.appPid) {
      const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
      const powershell = join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
      const script =
        '$app = Get-Process -Id ([int]$env:NOOK_HANDOVER_PID) -ErrorAction SilentlyContinue; if ($app -and $app.Path -eq $env:NOOK_HANDOVER_EXE) { [void]$app.CloseMainWindow(); if (-not $app.WaitForExit(10000)) { $app.Kill(); if (-not $app.WaitForExit(15000)) { throw "Managed application did not exit" } } }'
      await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        timeout: 30000,
        env: {
          ...process.env,
          NOOK_HANDOVER_PID: String(state.appPid),
          NOOK_HANDOVER_EXE: electron,
        },
      })
      process.stdout.write(
        'Remote supervisor paused for development; it resumes when this session exits.\n',
      )
    }
    return release
  } catch (error) {
    await release()
    throw error
  }
}
