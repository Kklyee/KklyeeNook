import type { Toolkit } from '@assistant-ui/react'

import { createToolCallRenderer } from './ToolCallRenderer'

type ReadArgs = { path?: string; file_path?: string }
type BashArgs = { command?: string }

const ReadToolCall = createToolCallRenderer<ReadArgs>({
  label: 'Read file',
  activeLabel: 'Reading file',
  getQuery: (args) => args.path ?? args.file_path ?? '',
})

const BashToolCall = createToolCallRenderer<BashArgs>({
  label: 'Ran command',
  activeLabel: 'Running command',
  getQuery: (args) => args.command ?? '',
})

export const assistantToolkit = {
  read: { type: 'backend', render: ReadToolCall },
  bash: { type: 'backend', render: BashToolCall },
} satisfies Toolkit
