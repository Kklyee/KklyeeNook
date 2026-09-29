import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import {
  ToolCard,
  ToolDetailSection,
  toolCodeClassName,
} from '@/renderer/src/components/assistant-ui/elements/tool-call'
import { formatToolResult, getStringValue, isRecord, previewText } from '../toolUtils'

export const ReadToolRenderer: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const values = isRecord(args) ? args : {}
  const path = getStringValue(values, 'path', 'file_path') ?? ''
  const content = formatToolResult(result)

  return (
    <ToolCard toolName="read" label="Read file" summary={path} status={status}>
      {content && (
        <ToolDetailSection label="Preview">
          <pre className={toolCodeClassName}>{previewText(content, 20, 1800)}</pre>
        </ToolDetailSection>
      )}
    </ToolCard>
  )
}
