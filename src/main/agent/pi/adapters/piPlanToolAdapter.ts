import { Type } from 'typebox'

import type { ExecutableTool } from '@/main/tools/executable-tool'
import { defineExecutableTool } from '@/main/tools/executable-tool'
import {
  parseAgentPlan,
  type AgentPlan,
  type AgentPlanToolInput,
} from '@/shared/agent/agentPlan'
import type { ToolRegistration } from '@/main/tools/toolRegistry'
import { ToolRegistry } from '@/main/tools/toolRegistry'

const stepStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('in_progress'),
  Type.Literal('completed'),
  Type.Literal('failed'),
])

const planSchema = Type.Object({
  steps: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Stable step identifier' }),
      title: Type.String({ description: 'Short step description' }),
      status: stepStatusSchema,
    }),
    { minItems: 1 },
  ),
})

export function createPlanToolDefinition(): ExecutableTool<typeof planSchema, AgentPlan> {
  return defineExecutableTool({
    name: 'update_plan',
    label: 'Update plan',
    description:
      'Create or update a concise execution plan for complex tasks. Every step must include a stable ID, short title, and current status. For a new plan, set the first active step to in_progress and later steps to pending. After each meaningful step, call this tool again with completed, in_progress, pending, or failed statuses. Before the final answer, mark successful steps completed and blocked steps failed. This tool records state; it does not execute steps. Do not use it for simple tasks.',
    promptSnippet: 'Create or update a plan and keep every step status current',
    parameters: planSchema,
    async execute(_toolCallId, params) {
      const plan = parseAgentPlan(params as AgentPlanToolInput)
      if (!plan) throw new Error('Invalid execution plan')
      const completed = plan.steps.filter((step) => step.status === 'completed').length
      return {
        content: [{ type: 'text', text: `Plan updated: ${completed}/${plan.steps.length}` }],
        details: plan,
      }
    },
  })
}

export function registerPiPlanTool(registry: ToolRegistry): void {
  const tool = createPlanToolDefinition()
  const registration: ToolRegistration<typeof tool> = {
    definition: {
      name: tool.name,
      label: tool.label,
      description: tool.description,
      inputSchema: tool.parameters,
    },
    adapter: { runtime: 'pi', create: () => createPlanToolDefinition() },
  }
  registry.register(registration)
}
