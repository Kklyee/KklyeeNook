import type { PermissionMode } from '@/shared/approval/permission'
import { WindowsSandboxBackend } from './windowsSandboxBackend'
export { WindowsSandboxBackend } from './windowsSandboxBackend'
export type SandboxSupport = 'full' | 'partial' | 'unavailable'
export interface SandboxExecutionRequest {
  mode: PermissionMode
  command: string
  cwd?: string
  workspaceRoot?: string
  privateTemp?: string
  runId?: string
  signal?: AbortSignal
  executeDirect(): Promise<SandboxExecutionResult>
}
export type SandboxExecutionResult =
  import('@earendil-works/pi-agent-core').AgentToolResult<unknown> & { isError?: boolean }
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
export function platformSandboxBackend(userData?: string): SandboxBackend {
  return process.platform === 'win32'
    ? new WindowsSandboxBackend(userData)
    : process.platform === 'darwin'
      ? new MacSandboxBackend()
      : new LinuxSandboxBackend()
}
