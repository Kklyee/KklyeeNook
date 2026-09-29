import type { ReactNode } from 'react'
import type { ToolCallMessagePartComponent, ToolCallMessagePartStatus } from '@assistant-ui/react'

import {
  getToolDisplayName,
  ToolCard,
  ToolDetailSection,
  toolCodeClassName,
} from '@/renderer/src/components/assistant-ui/elements/tool-call'
import { formatToolResult, getToolSummary, stringifyValue } from '../toolUtils'

type GenericToolCardProps = {
  toolName: string
  args: unknown
  argsText: string
  result?: unknown
  status: ToolCallMessagePartStatus
  details?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideResult?: boolean
}

export function GenericToolCard({
  toolName,
  args,
  argsText,
  result,
  status,
  details,
  open,
  onOpenChange,
  hideResult,
}: GenericToolCardProps) {
  const summary = getToolSummary(args, argsText)
  const argsPreview = argsText || stringifyValue(args)
  const resultPreview = formatToolResult(result)

  return (
    <ToolCard
      toolName={toolName}
      label={getToolDisplayName(toolName)}
      summary={summary}
      status={status}
      open={open}
      onOpenChange={onOpenChange}
    >
      {argsPreview && (
        <ToolDetailSection label="Arguments">
          <pre className={toolCodeClassName}>{argsPreview}</pre>
        </ToolDetailSection>
      )}
      {details}
      {!hideResult && result !== undefined && (
        <ToolDetailSection label="Result">
          <pre className={toolCodeClassName}>{resultPreview}</pre>
        </ToolDetailSection>
      )}
    </ToolCard>
  )
}

export const GenericToolRenderer: ToolCallMessagePartComponent = (props) => (
  <GenericToolCard {...props} />
)
