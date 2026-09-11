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

export interface DeletePermissionGrantRequest {
  id: string
}
