import { defineTool, type ToolDefinition as PiToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

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
      status: Type.Optional(stepStatusSchema),
    }),
    { minItems: 1 },
  ),
})

export function createPlanToolDefinition(): PiToolDefinition<typeof planSchema, AgentPlan> {
  return defineTool({
    name: 'update_plan',
    label: 'Update plan',
    description:
      'Create or update a concise execution plan for complex tasks. Use stable step IDs and include the current status of every step. Do not use this tool for simple tasks.',
    promptSnippet: 'Create or update a plan for complex tasks',
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
      parameters: tool.parameters,
    },
    adapter: { runtime: 'pi', create: () => createPlanToolDefinition() },
  }
  registry.register(registration)
}
