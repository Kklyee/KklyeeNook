import { useAuiState, type Toolkit, type ToolCallMessagePartComponent } from '@assistant-ui/react'

import { completePlanSteps, parseAgentPlan, type AgentPlanStep } from '@/shared/agent/agentPlan'
import { AgentPlan } from '../../../components/assistant-ui/elements/agent-plan'
import { ToolCallRenderer } from './ToolCallRenderer'

type UpdatePlanArgs = { steps?: AgentPlanStep[] }

const UpdatePlanToolCall: ToolCallMessagePartComponent<UpdatePlanArgs, unknown> = ({ args }) => {
  const isThreadRunning = useAuiState((state) => state.thread.isRunning)
  const isLastMessage = useAuiState((state) => state.message.isLast)
  const messageStatus = useAuiState((state) => state.message.status?.type)
  const plan = parseAgentPlan(args)
  if (!plan) return null
  const runCompleted = !isThreadRunning && (!isLastMessage || messageStatus === 'complete')
  const displayPlan = runCompleted ? completePlanSteps(plan) : plan
  return <AgentPlan steps={displayPlan.steps} className="max-w-none" />
}

export const assistantToolkit = {
  read: { type: 'backend', render: ToolCallRenderer },
  bash: { type: 'backend', render: ToolCallRenderer },
  edit: { type: 'backend', display: 'standalone', render: ToolCallRenderer },
  write: { type: 'backend', display: 'standalone', render: ToolCallRenderer },
  update_plan: { type: 'backend', display: 'standalone', render: UpdatePlanToolCall },
  delegate_task: { type: 'backend', render: ToolCallRenderer },
  search_knowledge: { type: 'backend', render: ToolCallRenderer },
  read_knowledge: { type: 'backend', render: ToolCallRenderer },
} satisfies Toolkit
