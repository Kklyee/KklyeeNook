import type { Toolkit } from '@assistant-ui/react'
import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import { parseAgentPlan, type AgentPlanStep } from '@/shared/agent/agentPlan'
import { AgentPlan } from '../../../components/assistant-ui/elements/agent-plan'
import { createToolCallRenderer } from './ToolCallRenderer'

type ReadArgs = { path?: string; file_path?: string }
type BashArgs = { command?: string }
type CreateArtifactArgs = { title?: string; kind?: string }
type UpdatePlanArgs = { steps?: AgentPlanStep[] }

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

const UpdatePlanToolCall: ToolCallMessagePartComponent<UpdatePlanArgs, unknown> = ({ args }) => {
  const plan = parseAgentPlan(args)
  if (!plan) return null
  return <AgentPlan steps={plan.steps} className="max-w-none" />
}

export const assistantToolkit = {
  read: { type: 'backend', render: ReadToolCall },
  bash: { type: 'backend', render: BashToolCall },
  create_artifact: { type: 'backend', render: CreateArtifactToolCall },
  update_plan: { type: 'backend', display: 'standalone', render: UpdatePlanToolCall },
} satisfies Toolkit
