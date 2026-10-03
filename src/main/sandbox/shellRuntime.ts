import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { ToolExecutionError } from '@/shared/tool/toolExecutionResult'

export interface ShellRuntime {
  kind: 'powershell' | 'bash'
  executable: string
  baseArgs: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

export function resolveShellRuntime({
  platform = process.platform,
  workspaceRoot,
  env = process.env,
}: {
  platform?: NodeJS.Platform
  workspaceRoot: string
  env?: NodeJS.ProcessEnv
}): ShellRuntime {
  if (platform === 'win32')
    return {
      kind: 'powershell',
      executable: 'pwsh.exe',
      baseArgs: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Mta', '-Command'],
      cwd: workspaceRoot,
      env: { ...env, POWERSHELL_TELEMETRY_OPTOUT: '1', NO_COLOR: '1' },
    }
  return {
    kind: 'bash',
    executable: '/bin/bash',
    baseArgs: ['-c'],
    cwd: workspaceRoot,
    env: { ...env },
  }
}

export function shellExecutable(runtime: ShellRuntime): string {
  if (runtime.kind !== 'powershell') return runtime.executable
  const path = Object.entries(runtime.env).find(([key]) => key.toLowerCase() === 'path')?.[1]
  const executable = path
    ?.split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory.replace(/^"|"$/g, ''), runtime.executable))
    .find((candidate) => existsSync(candidate))
  if (!executable)
    throw new ToolExecutionError(
      'shell_runtime_unavailable',
      'PowerShell 7 is unavailable. Install pwsh.exe and add it to PATH.',
    )
  return executable
}

export function shellArgs(runtime: ShellRuntime, command: string): string[] {
  if (runtime.kind !== 'powershell') return [...runtime.baseArgs, command]
  return [
    ...runtime.baseArgs,
    '$OutputEncoding = [Text.Encoding]::UTF8; ' +
      "if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') { [Console]::InputEncoding = [Console]::OutputEncoding = $OutputEncoding; $PSStyle.OutputRendering = 'PlainText' }; $ErrorActionPreference = 'Stop'; " +
      command +
      '\nif (-not $?) { if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }',
  ]
}

export function shellRuntimeContext(workspaceRoot?: string): string {
  return [
    `Platform: ${process.platform === 'win32' ? 'Windows' : process.platform}`,
    `Shell: ${process.platform === 'win32' ? 'PowerShell 7' : 'POSIX shell'}`,
    `Working directory: ${workspaceRoot ?? 'Explicit absolute cwd required'}`,
    ...(process.platform === 'win32'
      ? [
          'Use native Windows paths and PowerShell syntax for the Shell tool (internal tool ID: bash). Use native read, write, edit, grep and find tools for file operations and searches.',
        ]
      : []),
  ].join('\n')
}
