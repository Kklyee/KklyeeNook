import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import { GenericToolCard } from '../generic/GenericToolRenderer'

export const WriteToolRenderer: ToolCallMessagePartComponent = (props) => <GenericToolCard {...props} />
