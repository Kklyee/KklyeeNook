import type {
  BashToolInput,
  EditToolInput,
  ReadToolInput,
  WriteToolInput,
} from '@earendil-works/pi-coding-agent'
import type { ApprovalRequest } from '@/shared/approval/approvalTypes'

export interface ApprovalCardViewModel {
  title: string
  subtitle: string
  command: string
}

export function toApprovalCardViewModel(request: ApprovalRequest): ApprovalCardViewModel {
  switch (request.toolName) {
    case 'read': {
      const { path } = request.args as ReadToolInput

      return {
        title: 'Read file',
        subtitle: 'The agent wants to read a file',
        command: `read ${path}`,
      }
    }

    case 'bash': {
      const { command } = request.args as BashToolInput

      return { title: 'Run command', subtitle: 'The agent wants to run a shell command', command }
    }

    case 'write': {
      const { path } = request.args as WriteToolInput

      return {
        title: 'Write file',
        subtitle: 'The agent wants to write a file',
        command: `write ${path}`,
      }
    }

    case 'edit': {
      const { path } = request.args as EditToolInput

      return {
        title: 'Edit file',
        subtitle: 'The agent wants to modify a file',
        command: `edit ${path}`,
      }
    }

    default:
      return {
        title: `Run ${request.toolName}`,
        subtitle: 'The agent is requesting permission',
        command: JSON.stringify(request.args, null, 2),
      }
  }
}
