import type { Toolkit } from '@assistant-ui/react'

import { BashToolCard } from './BashToolCard'
import { ReadToolCard } from './ReadToolCard'

export const piToolkit = {
  read: { type: 'backend', render: ReadToolCard },
  bash: { type: 'backend', render: BashToolCard },
} satisfies Toolkit
