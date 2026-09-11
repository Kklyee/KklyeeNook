import {
  PermissionGrant,
  type GrantScope,
} from '../../components/assistant-ui/elements/permission-grant'
import { useApproval } from './useApproval'

export function ApprovalPrompt() {
  const { request, respond } = useApproval()

  if (!request) {
    return null
  }

  const respondToGrant = (scope: GrantScope) => {
    switch (scope) {
      case 'once':
        respond('allow_once')
        break
      case 'session':
        respond('allow_session')
        break
      case 'always':
        respond('allow_always')
        break
      case 'denied':
        respond('deny')
        break
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-24 z-20 flex justify-center px-4">
      <PermissionGrant
        capability={request.permission.description}
        requester={request.toolName}
        reach={[
          request.permission.recursive
            ? `${request.permission.resource}/**`
            : request.permission.resource,
        ]}
        scope="pending"
        onGrant={respondToGrant}
      />
    </div>
  )
}
