export type ApprovalDecision = 'allow' | 'deny'

export interface ApprovalRequest {
  id: string
  toolCallId: string
  toolName: string
  args: unknown
  message?: string
}

export interface ApprovalResponse {
  id: string
  decision: ApprovalDecision
}
