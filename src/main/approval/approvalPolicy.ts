export class ApprovalPolicy {
  requiresApproval(toolName: string, _args: unknown): boolean {
    switch (toolName) {
      case 'write':
      case 'edit':
      case 'bash':
        return true

      default:
        return false
    }
  }
}
