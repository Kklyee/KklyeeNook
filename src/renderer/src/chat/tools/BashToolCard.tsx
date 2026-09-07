import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import { ToolCard } from './ToolCard'

type BashArgs = { command?: string }

export const BashToolCard: ToolCallMessagePartComponent<BashArgs, unknown> = ({ args, status }) => {
  const cardStatus =
    status.type === 'running'
      ? 'running'
      : status.type === 'complete'
        ? 'success'
        : status.type === 'incomplete'
          ? 'error'
          : 'running'

  return (
    <ToolCard icon=">_" title="Bash" description={args.command} status={cardStatus}>
      {args.command && (
        <pre
          style={{
            margin: 0,
            padding: 8,
            borderRadius: 6,
            background: '#111',
            color: '#eee',
            overflowX: 'auto',
          }}
        >
          {args.command}
        </pre>
      )}
    </ToolCard>
  )
}
