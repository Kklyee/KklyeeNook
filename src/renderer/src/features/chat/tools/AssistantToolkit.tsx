import type { Toolkit } from '@assistant-ui/react'

import { createToolCallRenderer } from './ToolCallRenderer'

type ReadArgs = { path?: string; file_path?: string }
type BashArgs = { command?: string }
type CreateArtifactArgs = { title?: string; kind?: string }

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

const CreateArtifactToolCall = createToolCallRenderer<CreateArtifactArgs>({
  label: 'Created artifact',
  activeLabel: 'Creating artifact',
  getQuery: (args) => args.title ?? args.kind ?? '',
})

export const assistantToolkit = {
  read: { type: 'backend', render: ReadToolCall },
  bash: { type: 'backend', render: BashToolCall },
  create_artifact: { type: 'backend', render: CreateArtifactToolCall },
} satisfies Toolkit
