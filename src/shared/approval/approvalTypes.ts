export type ApprovalDecision = 'allow_once' | 'allow_session' | 'allow_always' | 'deny'

export type PermissionGrantDuration = 'session' | 'always'
export type PermissionResourceKind = 'path' | 'command' | 'tool'

export interface PermissionDescriptor {
  toolName: string
  action: string
  resourceKind: PermissionResourceKind
  resource: string
  recursive: boolean
  description: string
}

export interface PermissionGrant {
  id: string
  effect: 'allow'
  duration: PermissionGrantDuration
  sessionId?: string
  permission: PermissionDescriptor
  createdAt: number
}

export interface ApprovalRequest {
  id: string
  toolCallId: string
  sessionId: string
  toolName: string
  args: unknown
  permission: PermissionDescriptor
  message?: string
}

export interface ApprovalResponse {
  id: string
  decision: ApprovalDecision
}

export interface DeletePermissionGrantRequest {
  id: string
}
