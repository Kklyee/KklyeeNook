import { createRequire } from 'node:module'
import { parse } from 'node:path'
import { ToolExecutionError } from '@kklyeenook/shared/tool/toolExecutionResult'
import { shellResult } from './processLauncher'
import { resolveShellRuntime, shellArgs, shellExecutable, type ShellRuntime } from './shellRuntime'
import type {
  SandboxBackend,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxSupport,
} from './sandboxBackend'

export interface MxcExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  warnings: string[]
}

export interface MxcRequest {
  command: string
  workingDirectory?: string
  timeoutMs?: number
  ui?: { disable: boolean; clipboard?: 'none' | 'read' | 'write' | 'all'; allowInputInjection?: boolean }
  filesystem?: { readwritePaths?: string[]; readonlyPaths?: string[]; deniedPaths?: string[] }
  environment?: Record<string, string | undefined>
  inheritDefaultEnvironment?: boolean
}

export interface MxcModule {
  getPlatformSupport(): { isSupported: boolean; reason: string }
  run(request: MxcRequest): Promise<MxcExecutionResult>
}

const require = createRequire(import.meta.url)

function loadMxc(): MxcModule | undefined {
  try {
    return require('@microsoft/mxc-sdk/v1') as MxcModule
  } catch {
    return undefined
  }
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function mxcCommandLine(runtime: ShellRuntime, command: string): string {
  const executable = shellExecutable(runtime)
  const script = shellArgs(runtime, command).at(-1)!
  if (runtime.kind !== 'powershell') return `${quotePosix(executable)} -c ${quotePosix(script)}`
  return `"${executable}" -NoLogo -NoProfile -NonInteractive -Mta -OutputFormat Text -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
}

export class MxcSandboxBackend implements SandboxBackend {
  private cachedSupport?: SandboxSupport
  constructor(private readonly load: () => MxcModule | undefined = loadMxc) {}

  support(): SandboxSupport {
    if (this.cachedSupport) return this.cachedSupport
    const mxc = this.load()
    if (!mxc) return (this.cachedSupport = 'unavailable')
    try {
      return (this.cachedSupport = mxc.getPlatformSupport().isSupported ? 'partial' : 'unavailable')
    } catch {
      return (this.cachedSupport = 'unavailable')
    }
  }

  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    if (request.mode === 'full-access') throw new Error('Restricted execution requires a sandbox mode')
    request.signal?.throwIfAborted()
    if (!request.workspaceRoot)
      throw new ToolExecutionError('workspace_root_acl_failed', 'Sandbox execution requires a workspace')
    const mxc = this.load()
    if (!mxc)
      throw new ToolExecutionError(
        'sandbox_policy_init_failed',
        'The MXC sandbox runtime is unavailable. Install @microsoft/mxc-sdk to enable it.',
      )
    const runtime = request.runtime ?? resolveShellRuntime({ workspaceRoot: request.cwd ?? request.workspaceRoot })
    const workspace = request.workspaceRoot
    const cwd = request.cwd ?? workspace
    try {
      const result = await mxc.run({
        command: mxcCommandLine(runtime, request.command),
        workingDirectory: cwd,
        ui: { disable: false, clipboard: 'none', allowInputInjection: false },
        filesystem:
          request.mode === 'read-only'
            ? { readonlyPaths: [workspace, parse(workspace).root] }
            : { readwritePaths: [workspace], readonlyPaths: [parse(workspace).root] },
        environment: runtime.env,
        inheritDefaultEnvironment: true,
      })
      const output = shellResult(runtime, result.stdout, result.stderr, result.exitCode)
      return {
        ...output,
        details: {
          ...(output.details as Record<string, unknown>),
          sandbox: {
            mode: request.mode,
            backend: 'mxc',
            enforcement: 'partial',
            timedOut: result.timedOut,
            warnings: result.warnings,
          },
        },
      }
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error
      if (request.signal?.aborted) throw request.signal.reason
      throw new ToolExecutionError(
        'sandbox_policy_init_failed',
        `MXC could not start the process.\nReason: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}