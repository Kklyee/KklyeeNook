import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('Windows sandbox setup requires Windows')
const action = process.argv[2]
if (action && !['--remove', '--install-task', '--remove-task'].includes(action))
  throw new Error('Invalid sandbox setup arguments')
if (process.argv.length > 3) throw new Error('Invalid sandbox setup arguments')

const helper = fileURLToPath(new URL('../resources/sandbox/windows-sandbox.exe', import.meta.url))
const task = 'KklyeeNook Windows Sandbox'
const powershell = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)
const quote = (value) => value.replaceAll("'", "''")

function spawn(command) {
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

function runElevated(lines) {
  const script = join(tmpdir(), `nook-sandbox-setup-${process.pid}.ps1`)
  writeFileSync(script, lines.join('\n'), 'utf8')
  try {
    return spawn(
      `$process = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${quote(script)}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode`,
    )
  } finally {
    rmSync(script, { force: true })
  }
}

function runHelper(argument) {
  return spawn(
    `$setup = Start-Process -FilePath '${quote(helper)}' -ArgumentList '${argument}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $setup.ExitCode`,
  )
}

const install = [
  '$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name',
  `$action = New-ScheduledTaskAction -Execute '${quote(helper)}' -Argument '--setup-devices'`,
  '$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user',
  '$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest',
  '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)',
  `Register-ScheduledTask -TaskName '${task}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`,
]

const status =
  action === '--install-task'
    ? runElevated(install)
    : action === '--remove-task'
      ? runElevated([
          `Unregister-ScheduledTask -TaskName '${task}' -Confirm:$false -ErrorAction SilentlyContinue`,
        ])
      : runHelper(action === '--remove' ? '--remove-device-grants' : '--setup-devices')
if (status !== 0) process.exit(status)