import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import { GenericToolCard } from '../generic/GenericToolRenderer'

export const ReadToolRenderer: ToolCallMessagePartComponent = (props) => (
  <GenericToolCard {...props} />
)
