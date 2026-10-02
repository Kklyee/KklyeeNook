import type { ToolCallMessagePartComponent } from '@assistant-ui/react'
import { useEffect, useRef } from 'react'
import { usePreview } from '@/renderer/src/features/preview/PreviewProvider'
import { resolveToolExecutionStatus } from '@/shared/tool/toolExecutionStatus'

import { BashToolRenderer } from './bash/BashToolRenderer'
import { EditToolRenderer } from './edit/EditToolRenderer'
import { GenericToolRenderer } from './generic/GenericToolRenderer'
import { ReadToolRenderer } from './read/ReadToolRenderer'
import { SubagentToolRenderer } from './subagent/SubagentToolRenderer'
import { WriteToolRenderer } from './write/WriteToolRenderer'
import { formatToolResult } from './toolUtils'
import { normalizeToolResult } from '@/shared/tool/toolExecutionResult'
import { ToolResultRetention } from '@/renderer/src/components/assistant-ui/elements/tool-result-retention'

export { formatToolResult }

const toolRenderers: Record<string, ToolCallMessagePartComponent> = {
  read: ReadToolRenderer,
  bash: BashToolRenderer,
  edit: EditToolRenderer,
  write: WriteToolRenderer,
  delegate_task: SubagentToolRenderer,
}

export const ToolCallRenderer: ToolCallMessagePartComponent = (props) => {
  const { refreshFile } = usePreview()
  const refreshed = useRef<string | undefined>(undefined)
  const Renderer = toolRenderers[props.toolName] ?? GenericToolRenderer
  const result = props.result === undefined ? undefined : normalizeToolResult(props.result, props.isError)
  const status = resolveToolExecutionStatus(props.status, props.isError, formatToolResult(result))
  useEffect(() => {
    if (status.type !== 'complete' || result?.status !== 'success' ||
      (props.toolName !== 'write' && props.toolName !== 'edit') || refreshed.current === props.toolCallId) return
    refreshed.current = props.toolCallId
    const path = props.args.path ?? props.args.file_path
    if (typeof path === 'string') refreshFile(path)
  }, [status.type, result, props.toolName, props.toolCallId, props.args, refreshFile])
  return <><Renderer {...props} result={result} status={status} /><ToolResultRetention result={result} /></>
}
