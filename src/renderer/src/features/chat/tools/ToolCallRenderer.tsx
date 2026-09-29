import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import { BashToolRenderer } from './bash/BashToolRenderer'
import { EditToolRenderer } from './edit/EditToolRenderer'
import { GenericToolRenderer } from './generic/GenericToolRenderer'
import { ReadToolRenderer } from './read/ReadToolRenderer'
import { SubagentToolRenderer } from './subagent/SubagentToolRenderer'
import { WriteToolRenderer } from './write/WriteToolRenderer'
import { formatToolResult } from './toolUtils'

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
  return <Renderer {...props} />
}
