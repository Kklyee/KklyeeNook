import type { PermissionMode } from '@/shared/approval/permission'
export interface SandboxExecutionRequest {
  mode: PermissionMode
  command: string
  cwd?: string
  signal?: AbortSignal
  executeDirect(): Promise<SandboxExecutionResult>
}
export type SandboxExecutionResult =
  import('@earendil-works/pi-agent-core').AgentToolResult<unknown>
export interface SandboxBackend {
  support(): 'full' | 'partial' | 'unavailable'
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>
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
export class WindowsSandboxBackend extends UnavailableSandboxBackend {}
export class DirectExecutionBackend implements SandboxBackend {
  support(): 'full' {
    return 'full'
  }
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    if (request.mode !== 'full-access') throw new Error('Direct execution requires full access')
    return request.executeDirect()
  }
}
export function platformSandboxBackend(): SandboxBackend {
  return process.platform === 'win32'
    ? new WindowsSandboxBackend()
    : process.platform === 'darwin'
      ? new MacSandboxBackend()
      : new LinuxSandboxBackend()
}
