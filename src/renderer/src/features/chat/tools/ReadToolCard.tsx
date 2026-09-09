import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import { ToolCard } from './ToolCard'

type ReadArgs = { path?: string; file_path?: string }

export const ReadToolCard: ToolCallMessagePartComponent<ReadArgs, unknown> = ({ args, status }) => {
  const path = args.path ?? args.file_path ?? '未知文件'

  let cardStatus: 'running' | 'success' | 'error' | 'cancelled'

  switch (status.type) {
    case 'running':
      cardStatus = 'running'
      break
    case 'complete':
      cardStatus = 'success'
      break
    case 'incomplete':
      cardStatus = status.reason === 'cancelled' ? 'cancelled' : 'error'
      break
    default:
      cardStatus = 'running'
  }

  return <ToolCard icon="📖" title="Read" description={path} status={cardStatus} />
}
