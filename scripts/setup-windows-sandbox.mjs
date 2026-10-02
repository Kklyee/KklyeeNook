import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('Windows sandbox setup requires Windows')
const remove = process.argv[2] === '--remove'
if (process.argv.length > (remove ? 3 : 2)) throw new Error('Invalid sandbox setup arguments')
const helper = fileURLToPath(new URL('../resources/sandbox/windows-sandbox.exe', import.meta.url))
const command = `$setup = Start-Process -FilePath '${helper.replaceAll("'", "''")}' -ArgumentList '${remove ? '--remove-device-grants' : '--setup-devices'}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $setup.ExitCode`
const result = spawnSync(
  join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  ),
  ['-NoProfile', '-NonInteractive', '-Command', command],
  { stdio: 'inherit', windowsHide: true },
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
