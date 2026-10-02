import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import { usePreview } from '@/renderer/src/features/preview/PreviewProvider'
import { FileResultCard, resolveFileResultStatus } from '../FileResultCard'
import { getStringValue, isRecord } from '../toolUtils'

export const EditToolRenderer: ToolCallMessagePartComponent = ({ args, status }) => {
  const { open } = usePreview()
  const values = isRecord(args) ? args : {}
  const path = getStringValue(values, 'path', 'file_path')
  if (!path) return null
  if (status.type === 'complete') return null

  return (
    <FileResultCard
      path={path}
      operation="modified"
      status={resolveFileResultStatus(status)}
      onPreview={() => open({ kind: 'workspace-file', path })}
    />
  )
}
