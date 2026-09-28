export type AgentPlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface AgentPlanStep {
  id: string
  title: string
  status: AgentPlanStepStatus
}

export interface AgentPlan {
  steps: AgentPlanStep[]
}

export interface AgentPlanToolInput {
  steps: Array<{
    id: string
    title: string
    status: AgentPlanStepStatus
  }>
}

export function completePlanSteps(plan: AgentPlan): AgentPlan {
  let changed = false
  const steps = plan.steps.map((step) => {
    if (step.status === 'completed' || step.status === 'failed') return step
    changed = true
    return { ...step, status: 'completed' as const }
  })
  return changed ? { steps } : plan
}

const PLAN_STEP_STATUSES = new Set<AgentPlanStepStatus>([
  'pending',
  'in_progress',
  'completed',
  'failed',
])

export function parseAgentPlan(value: unknown): AgentPlan | undefined {
  const candidate = unwrapPlan(value)
  if (!isRecord(candidate) || !Array.isArray(candidate.steps) || candidate.steps.length === 0) {
    return undefined
  }

  const ids = new Set<string>()
  const steps: AgentPlanStep[] = []
  for (const value of candidate.steps) {
    if (!isRecord(value)) return undefined
    const id = typeof value.id === 'string' ? value.id.trim() : ''
    const title = typeof value.title === 'string' ? value.title.trim() : ''
    const status = value.status === undefined ? 'pending' : value.status
    if (
      !id ||
      !title ||
      ids.has(id) ||
      typeof status !== 'string' ||
      !PLAN_STEP_STATUSES.has(status as AgentPlanStepStatus)
    ) {
      return undefined
    }
    ids.add(id)
    steps.push({ id, title, status: status as AgentPlanStepStatus })
  }

  return { steps }
}

function unwrapPlan(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (isRecord(value.details)) return value.details
  if (isRecord(value.plan)) return value.plan
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
