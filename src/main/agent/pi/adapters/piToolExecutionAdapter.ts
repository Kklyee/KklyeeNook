import type { Agent } from '@earendil-works/pi-agent-core'
import { Type, type TSchema } from 'typebox'
import type { ToolExecutionHarness } from '@/main/agent/toolExecutionHarness'
import type { ToolAdapterContext, ToolRegistry } from '@/main/tools/toolRegistry'
import { normalizeToolResult } from '@/shared/tool/toolExecutionResult'
import { normalizePiToolExecutionEnd } from './piEventAdapter'

export function installPiToolExecutionHarness(
  agent: Agent,
  registry: ToolRegistry,
  harness: ToolExecutionHarness,
  context: ToolAdapterContext,
  getRunId: () => string,
): void {
  let harnessFailure: unknown
  agent.subscribe((event) => {
    if (event.type === 'agent_start') harnessFailure = undefined
    if (event.type === 'tool_execution_end') {
      normalizePiToolExecutionEnd(event)
      if (harnessFailure) throw harnessFailure
    }
  })
  const schemas = new Map(
    agent.state.tools.map((tool) => [
      tool.name,
      registry.get(tool.name)?.inputSchema ?? tool.parameters,
    ]),
  )
  agent.state.tools = agent.state.tools.map((tool) => ({
    ...tool,
    parameters: Type.Unknown(),
    prepareArguments: undefined,
    execute: async (id, args, signal, onUpdate) => {
      try {
        const result = await harness.execute(
          getRunId(),
          { id, toolName: tool.name, args },
          context,
          (input, executionSignal) =>
            tool.execute(id, input, executionSignal, (partial) => {
              if (!executionSignal.aborted) onUpdate?.(partial)
            }),
          signal,
        )
        const { content, toolCallId: _id, toolName: _name, ...metadata } = result
        return { content, details: metadata }
      } catch (error) {
        harnessFailure = error
        throw error
      }
    },
  }))
  const stream = agent.streamFunction
  agent.streamFunction = (model, modelContext, options) =>
    stream(
      model,
      {
        ...modelContext,
        tools: modelContext.tools?.map((tool) => ({
          ...tool,
          parameters: schemas.get(tool.name) as TSchema,
        })),
      },
      options,
    )
  const afterToolCall = agent.afterToolCall
  agent.afterToolCall = async (context, signal) => {
    const result = await afterToolCall?.(context, signal)
    return {
      ...result,
      isError: normalizeToolResult(context.result, context.isError).status === 'error',
    }
  }
}
