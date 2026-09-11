import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResponse,
} from '@/shared/approval/approvalTypes'

type ApprovalListener = (request: ApprovalRequest) => void
type PendingApproval = { request: ApprovalRequest; resolve: (decision: ApprovalDecision) => void }

export class ApprovalService {
  private pending = new Map<string, PendingApproval>()
  private listeners = new Set<ApprovalListener>()

  subscribe(listener: ApprovalListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private emitRequest(request: ApprovalRequest): void {
    for (const listener of this.listeners) {
      listener(request)
    }
  }

  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    const promise = new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(request.id, { request, resolve })
    })

    this.emitRequest(request)
    return promise
  }

  respond(response: ApprovalResponse): void {
    const pending = this.pending.get(response.id)

    if (!pending) {
      return
    }

    this.pending.delete(response.id)
    pending.resolve(response.decision)
  }
}
