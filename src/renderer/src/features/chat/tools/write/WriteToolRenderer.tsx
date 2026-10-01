import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import {
  ToolCard,
  ToolDetailSection,
  toolCodeClassName,
} from '@/renderer/src/components/assistant-ui/elements/tool-call'
import { formatToolResult, getStringValue, isRecord, previewText } from '../toolUtils'

export const WriteToolRenderer: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const values = isRecord(args) ? args : {}
  const resultValues = isRecord(result) ? result : {}
  const path = getStringValue(values, 'path', 'file_path') ?? ''
  const content = getStringValue(values, 'content', 'text') ?? formatToolResult(result)
  const failed = status.type === 'incomplete'
  const operation = failed
    ? 'Failed'
    : status.type === 'requires-action'
      ? 'Awaiting approval'
      : status.type === 'running'
        ? 'Writing'
        : resultValues.created === true
          ? 'Created'
          : resultValues.updated === true
            ? 'Updated'
            : 'Written'

  return (
    <ToolCard toolName="write" label="Write file" summary={path} status={status}>
      {path && (
        <ToolDetailSection label="Path">
          <p className="truncate font-mono text-[11px] text-text-default">{path}</p>
        </ToolDetailSection>
      )}
      <ToolDetailSection label="Status">
        <p className="text-[11px] text-text-default">{operation}</p>
      </ToolDetailSection>
      {failed && status.error !== undefined && (
        <ToolDetailSection label="Error">
          <p className="whitespace-pre-wrap text-[11px] text-danger">
            {formatToolResult(status.error)}
          </p>
        </ToolDetailSection>
      )}
      {content && (
        <ToolDetailSection label={failed ? 'Requested content' : 'Preview'}>
          <pre className={toolCodeClassName}>{previewText(content, 12, 1200)}</pre>
        </ToolDetailSection>
      )}
    </ToolCard>
  )
}
