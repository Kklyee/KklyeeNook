import type { ApprovalRequest } from '@/shared/approval/approvalTypes'

export interface ApprovalCardViewModel {
  title: string
  subtitle: string
  command: string
}

function getStringArgument(args: unknown, key: string): string | undefined {
  if (typeof args !== 'object' || args === null) {
    return undefined
  }

  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

export function toApprovalCardViewModel(request: ApprovalRequest): ApprovalCardViewModel {
  switch (request.toolName) {
    case 'read': {
      const path = getStringArgument(request.args, 'path') ?? '(unknown path)'

      return {
        title: 'Read file',
        subtitle: 'The agent wants to read a file',
        command: `read ${path}`,
      }
    }

    case 'bash': {
      const command = getStringArgument(request.args, 'command') ?? '(unknown command)'

      return { title: 'Run command', subtitle: 'The agent wants to run a shell command', command }
    }

    case 'write': {
      const path = getStringArgument(request.args, 'path') ?? '(unknown path)'

      return {
        title: 'Write file',
        subtitle: 'The agent wants to write a file',
        command: `write ${path}`,
      }
    }

    case 'edit': {
      const path = getStringArgument(request.args, 'path') ?? '(unknown path)'

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
