import type { ToolCallMessagePartComponent } from '@assistant-ui/react'
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
  create_artifact: GenericToolRenderer,
  delegate_task: SubagentToolRenderer,
}

export const ToolCallRenderer: ToolCallMessagePartComponent = (props) => {
  const Renderer = toolRenderers[props.toolName] ?? GenericToolRenderer
  const result = props.result === undefined ? undefined : normalizeToolResult(props.result, props.isError)
  const status = resolveToolExecutionStatus(props.status, props.isError, formatToolResult(result))
  return <><Renderer {...props} result={result} status={status} /><ToolResultRetention result={result} /></>
}
