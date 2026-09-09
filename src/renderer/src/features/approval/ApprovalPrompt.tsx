import { ApprovalCard } from './ApprovalCard'
import { useApproval } from './useApproval'
import { toApprovalCardViewModel } from './approvalViewModel'

export function ApprovalPrompt() {
  const { request, respond } = useApproval()

  if (!request) {
    return null
  }

  const model = toApprovalCardViewModel(request)

  return (
    <div className="absolute inset-x-0 bottom-24 z-20 flex justify-center px-4">
      <ApprovalCard
        state="request"
        title={model.title}
        subtitle={model.subtitle}
        command={model.command}
        onAllowOnce={() => respond('allow')}
        onDeny={() => respond('deny')}
      />
    </div>
  )
}
