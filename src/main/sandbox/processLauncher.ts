import { spawn } from 'node:child_process'
import { ToolExecutionError } from '@/shared/tool/toolExecutionResult'
import type { SandboxExecutionResult } from './sandboxBackend'
import { shellArgs, shellExecutable, type ShellRuntime } from './shellRuntime'

export function shellResult(
  runtime: ShellRuntime,
  stdout: string,
  stderr: string,
  exitCode: number,
): SandboxExecutionResult {
  const text = stdout + stderr
  return {
    content: [
      {
        type: 'text',
        text: exitCode === 0 ? text : `${text}\nCommand exited with code ${exitCode}`,
      },
    ],
    details: {
      stdout,
      stderr,
      exitCode,
      shell: runtime.kind === 'powershell' ? 'PowerShell 7' : runtime.kind,
      cwd: runtime.cwd,
    },
    isError: exitCode !== 0,
  }
}

export async function launchShellProcess(
  runtime: ShellRuntime,
  command: string,
  signal?: AbortSignal,
): Promise<SandboxExecutionResult> {
  signal?.throwIfAborted()
  const executable = shellExecutable(runtime)
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, shellArgs(runtime, command), {
      cwd: runtime.cwd,
      env: runtime.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const cancel = () => {
      if (!child.pid) return
      if (process.platform === 'win32')
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        }).once('error', () => child.kill())
      else process.kill(-child.pid, 'SIGKILL')
    }
    child.stdout.on('data', (data) => stdout.push(Buffer.from(data)))
    child.stderr.on('data', (data) => stderr.push(Buffer.from(data)))
    child.once('error', (error) => {
      signal?.removeEventListener('abort', cancel)
      reject(new ToolExecutionError('process_spawn_failed', error.message))
    })
    child.once('close', (code) => {
      signal?.removeEventListener('abort', cancel)
      if (signal?.aborted) reject(signal.reason)
      else if (code === null)
        reject(
          new ToolExecutionError(
            'process_spawn_failed',
            'Shell process terminated without an exit code',
          ),
        )
      else resolve(code)
    })
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
  })
  return shellResult(
    runtime,
    Buffer.concat(stdout).toString('utf8'),
    Buffer.concat(stderr).toString('utf8'),
    exitCode,
  )
}
