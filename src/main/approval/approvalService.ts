import type { ApprovalRequest, ApprovalResponse } from '@/shared/approval/approvalTypes'

type PendingApprovalRequest = { request: ApprovalRequest; resolve: (allowed: boolean) => void }

export class ApprovalService {
  private pending = new Map<string, PendingApprovalRequest>()

  async request(request: ApprovalRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pending.set(request.id, { request, resolve })
    })
  }

  async respond(response: ApprovalResponse): Promise<void> {
    const pending = this.pending.get(response.id)
    if (!pending) {
      return
    }
    this.pending.delete(response.id)

    pending.resolve(response.decision === 'allow')
  }
}
