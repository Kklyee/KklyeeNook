import type { AgentExecutionContext } from '../workspace/workspace'

export type PermissionMode = 'read-only' | 'workspace-write' | 'full-access'
export const PERMISSION_MODES: PermissionMode[] = ['read-only', 'workspace-write', 'full-access']
export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  'read-only': '仅可查看',
  'workspace-write': '工作区内修改',
  'full-access': '完全权限',
}
export type PermissionResource =
  | { kind: 'path'; path: string; action: 'read' | 'write' | 'edit' | 'artifact-apply' }
  | { kind: 'command'; command: string; cwd?: string }
  | { kind: 'tool'; name: string }
export interface PermissionRequest extends AgentExecutionContext {
  mode: PermissionMode
  toolName: string
  resource: PermissionResource
}
export type PermissionDecision =
  | { outcome: 'allow' }
  | { outcome: 'deny'; reason: string }
  | { outcome: 'ask'; requestedMode: 'workspace-write' | 'full-access'; reason: string }
export function effectivePermissionMode(
  mode: PermissionMode | null | undefined,
  workspaceAvailable: boolean,
  defaultMode: PermissionMode = 'workspace-write',
): PermissionMode {
  const requested =
    mode ??
    (workspaceAvailable ? defaultMode : defaultMode === 'full-access' ? 'full-access' : 'read-only')
  return requested === 'workspace-write' && !workspaceAvailable ? 'read-only' : requested
}
