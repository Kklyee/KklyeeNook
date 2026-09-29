import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import {
  ToolCard,
  ToolDetailSection,
  toolCodeClassName,
} from '@/renderer/src/components/assistant-ui/elements/tool-call'
import { getStringValue, isRecord, previewText } from '../toolUtils'

export const EditToolRenderer: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const values = isRecord(args) ? args : {}
  const path = getStringValue(values, 'path', 'file_path') ?? ''
  const oldText = getStringValue(values, 'oldText', 'old_text', 'old_string', 'old')
  const newText = getStringValue(values, 'newText', 'new_text', 'new_string', 'new')
  const patch = getStringValue(values, 'diff', 'patch')
  const resultDetails = isRecord(result) && isRecord(result.details) ? result.details : {}
  const resultDiff = getStringValue(resultDetails, 'diff', 'patch')
  const edits = Array.isArray(values.edits) ? values.edits.filter(isRecord) : []
  const diff =
    resultDiff ??
    patch ??
    (edits.length
      ? edits
          .map((edit) => {
            const oldValue = getStringValue(edit, 'oldText', 'old_text', 'old_string') ?? ''
            const newValue = getStringValue(edit, 'newText', 'new_text', 'new_string') ?? ''
            return `− ${oldValue}\n+ ${newValue}`
          })
          .join('\n\n')
      : undefined)

  return (
    <ToolCard toolName="edit" label="Edit file" summary={path} status={status}>
      <ToolDetailSection label="Diff">
        {diff ? (
          <pre className={toolCodeClassName}>{previewText(diff, 40, 3000)}</pre>
        ) : oldText !== undefined || newText !== undefined ? (
          <div className="space-y-2">
            {oldText !== undefined && (
              <pre className={toolCodeClassName}>
                <span className="text-danger">− </span>
                {previewText(oldText, 24, 1800)}
              </pre>
            )}
            {newText !== undefined && (
              <pre className={toolCodeClassName}>
                <span className="text-success">+ </span>
                {previewText(newText, 24, 1800)}
              </pre>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-text-muted">No diff provided.</p>
        )}
      </ToolDetailSection>
    </ToolCard>
  )
}
