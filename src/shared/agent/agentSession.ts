import type { PermissionMode } from '@/shared/approval/permission'
export interface AgentSessionSummary {
  workspaceId?: string | null
  permissionMode?: PermissionMode | null
  id: string
  title?: string
  createdAt: number
  updatedAt: number
  archived?: boolean
  activeRunId?: string
}
