import type { PermissionMode } from '@kklyeenook/shared/approval/permission'
export interface AgentSessionSummary {
  botId?: string | null
  workspaceId?: string | null
  permissionMode?: PermissionMode | null
  id: string
  title?: string
  createdAt: number
  updatedAt: number
  archived?: boolean
  activeRunId?: string
}
