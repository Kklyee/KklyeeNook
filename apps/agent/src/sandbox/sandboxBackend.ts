import type { PermissionMode } from '@kklyeenook/shared/approval/permission'
import { WindowsSandboxBackend } from './windowsSandboxBackend'
import type { ShellRuntime } from './shellRuntime'
import { MxcSandboxBackend } from './mxcSandboxBackend'
export { WindowsSandboxBackend } from './windowsSandboxBackend'
export type SandboxSupport = 'full' | 'partial' | 'unavailable'
export interface SandboxExecutionRequest {
  mode: PermissionMode
  command: string
  runtime?: ShellRuntime
  cwd?: string
  workspaceRoot?: string
  privateTemp?: string
  runId?: string
  signal?: AbortSignal
  executeDirect(): Promise<SandboxExecutionResult>
}
export type SandboxExecutionResult =
  { content: import('@kklyeenook/shared/tool/tool').ToolContent[]; details: unknown; isError?: boolean }
export interface SandboxBackend {
  support(): SandboxSupport
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>
  finishRun?(runId: string): Promise<void>
}

class UnavailableSandboxBackend implements SandboxBackend {
  support(): 'unavailable' {
    return 'unavailable'
  }
  async execute(_request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    throw new Error('当前平台系统沙箱尚不可用')
  }
}
export class LinuxSandboxBackend extends UnavailableSandboxBackend {}
export class MacSandboxBackend extends UnavailableSandboxBackend {}
export class DirectExecutionBackend implements SandboxBackend {
  support(): 'full' {
    return 'full'
  }
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    if (request.mode !== 'full-access') throw new Error('Direct execution requires full access')
    return request.executeDirect()
  }
}
class FallbackSandboxBackend implements SandboxBackend {
  constructor(
    private readonly primary: SandboxBackend,
    private readonly secondary: SandboxBackend,
  ) {}
  private active(): SandboxBackend {
    return this.primary.support() === 'unavailable' ? this.secondary : this.primary
  }
  support(): SandboxSupport {
    const support = this.primary.support()
    return support === 'unavailable' ? this.secondary.support() : support
  }
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    return this.active().execute(request)
  }
  finishRun(runId: string): Promise<void> {
    return this.active().finishRun?.(runId) ?? Promise.resolve()
  }
}
export function platformSandboxBackend(userData?: string): SandboxBackend {
  const mxc = new MxcSandboxBackend()
  if (process.platform === 'win32')
    return new FallbackSandboxBackend(new WindowsSandboxBackend(userData), mxc)
  if (process.platform === 'darwin') return new FallbackSandboxBackend(new MacSandboxBackend(), mxc)
  return new FallbackSandboxBackend(new LinuxSandboxBackend(), mxc)
}
