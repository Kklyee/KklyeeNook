import {
  defineTool,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import type {
  DelegateTaskInput,
  DelegateTaskProgress,
  DelegateTaskResult,
} from '@/shared/agent/delegateTask'
import type { ToolRegistration } from '@/main/tools/toolRegistry'
import { ToolRegistry } from '@/main/tools/toolRegistry'

const delegateTaskSchema = Type.Object({
  task: Type.String({ description: 'A focused task for the child run' }),
  skillIds: Type.Optional(
    Type.Array(Type.String({ description: 'Skill ID to make available to the child run' })),
  ),
  context: Type.Optional(
    Type.String({ description: 'Small amount of context explicitly provided by the parent' }),
  ),
})

type DelegateTaskToolDetails = DelegateTaskResult | DelegateTaskProgress
type DelegateTaskTool = PiToolDefinition<typeof delegateTaskSchema, DelegateTaskToolDetails>
type DelegateTaskExecutor = (
  parentRunId: string,
  input: DelegateTaskInput,
  onProgress?: (progress: DelegateTaskProgress) => void,
) => Promise<DelegateTaskResult>

function createDelegateTaskToolDefinition(
  execute: DelegateTaskExecutor,
  getParentRunId: () => string | undefined,
): DelegateTaskTool {
  return defineTool({
    name: 'delegate_task',
    label: 'Delegate task',
    description:
      'Delegate one focused task to an independent child run. The child receives only the task, selected skills, workspace memory, and explicit context. Up to two child runs can run at once, and child runs cannot delegate further.',
    promptSnippet: 'Delegate one focused task to an independent child run',
    parameters: delegateTaskSchema,
    async execute(_toolCallId, params, _signal, onUpdate) {
      const task = params.task.trim()
      if (!task) throw new Error('Task is required')
      const parentRunId = getParentRunId()
      if (!parentRunId) throw new Error('delegate_task requires an active AgentRun')
      const result = await execute(
        parentRunId,
        {
          task,
          ...(params.skillIds?.length ? { skillIds: params.skillIds } : {}),
          ...(params.context?.trim() ? { context: params.context.trim() } : {}),
        },
        (progress) => {
          onUpdate?.({
            content: [{ type: 'text', text: JSON.stringify(progress) }],
            details: progress,
          })
        },
      )
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
    },
  })
}

export function registerPiDelegateTaskTool(
  registry: ToolRegistry,
  execute: DelegateTaskExecutor,
): void {
  const metadataTool = createDelegateTaskToolDefinition(execute, () => undefined)
  const registration: ToolRegistration<DelegateTaskTool> = {
    definition: {
      name: metadataTool.name,
      label: metadataTool.label,
      description: metadataTool.description,
      parameters: metadataTool.parameters,
    },
    adapter: {
      runtime: 'pi',
      create: (context) =>
        createDelegateTaskToolDefinition(execute, context.getRunId ?? (() => undefined)),
    },
  }
  registry.register(registration)
}
