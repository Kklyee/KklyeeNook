import { copyJson, type Context } from '@earendil-works/chord'
import {
  defineExtension,
  defineTool,
  type ConversationId,
  type Harness,
  type JsonObject,
  type ToolExecutionApi,
} from '@earendil-works/pi-durable'
import type { TSchema } from 'typebox'
import type { PermissionRequest } from '@/shared/approval/permission'
import { effectivePermissionMode } from '@/shared/approval/permission'
import type { ToolCall, ToolExecutionResult } from '@/shared/tool/tool'
import type { ToolAdapterContext, ToolRegistry } from '../tools/toolRegistry'
import type { ToolResultRetentionPolicy } from '../tools/toolResultRetentionPolicy'
import { SandboxService, toolPermissionResource } from '../sandbox/sandboxService'
import { ToolExecutionHarness } from './toolExecutionHarness'
import { DurableApprovals } from './durable-approvals'

type ExecutableTool = {
  execute(
    id: string,
    args: unknown,
    signal?: AbortSignal,
    onUpdate?: (result: ToolExecutionResult) => void,
  ): Promise<unknown>
}

type ResolveContext = (
  conversationId: ConversationId,
  context: Context,
) => Promise<ToolAdapterContext>

function permission(call: ToolCall, context: ToolAdapterContext): PermissionRequest {
  const execution = context.executionContext ?? { conversationId: '' }
  return {
    ...execution,
    mode: effectivePermissionMode(execution.mode, Boolean(execution.workspace)),
    toolName: call.toolName,
    resource: toolPermissionResource(call.toolName, call.args),
  }
}

export class DurableTools {
  readonly approvals: DurableApprovals

  constructor(
    private readonly registry: ToolRegistry,
    private readonly sandbox: SandboxService,
    private readonly retention: ToolResultRetentionPolicy,
    private readonly resolveContext: ResolveContext,
  ) {
    this.approvals = new DurableApprovals(async (call, api, context) => {
      const adapter = await this.resolveContext(api.conversationId, context)
      const request = permission({ id: call.id, toolName: call.name, args: call.arguments }, adapter)
      const decision = await this.sandbox.policy.evaluate(request)
      if (decision.outcome === 'deny') return { block: decision.reason }
      if (decision.outcome === 'allow') return undefined
      return {
        request: copyJson({ permission: request, requestedMode: decision.requestedMode }) as JsonObject,
        reason: decision.reason,
      }
    })
  }

  connect(harness: Harness) {
    this.approvals.connect(harness)
  }

  extension() {
    return defineExtension({
      name: 'nook.tools',
      tools: this.registry.list().map((definition) => defineTool({
        name: definition.name,
        description: definition.description,
        parameters: definition.inputSchema as TSchema,
        replay: 'unsafe',
        execute: async (args, api, context) => this.execute(definition.name, args, api, context),
      })),
    })
  }

  private async execute(name: string, args: unknown, api: ToolExecutionApi, context: Context) {
    const adapter = await this.resolveContext(api.conversationId, context)
    const runId = `durable:${api.conversationId}:${api.taskId}`
    const call = { id: `${api.taskId}:${api.callId}`, toolName: name, args }
    const harness = new ToolExecutionHarness(
      this.registry, this.sandbox, this.retention,
      async (_call, decision) => this.approvals.authorized(
        api.conversationId, api.taskId, { id: api.callId, name, arguments: args as JsonObject, type: 'toolCall' },
        {
          request: copyJson({ permission: permission(call, adapter), requestedMode: decision.requestedMode }) as JsonObject,
          reason: decision.reason,
        }, context,
      ),
    )
    const [tool] = this.registry.resolve<ExecutableTool>('pi', [name], { ...adapter, getRunId: () => runId })
    try {
      const result = await harness.execute(
        runId, call, adapter,
        (input, signal) => tool.execute(api.callId, input, signal, (update) => {
          if (signal.aborted) return
          for (const part of update.content ?? []) if (part.type === 'text') api.output(part.text)
        }),
        context.abortSignal,
      )
      const { content, toolCallId: _id, toolName: _name, ...details } = result
      return {
        content,
        isError: result.status === 'error',
        details: copyJson(details, { omitUndefinedProperties: true }),
      }
    } finally {
      await this.sandbox.finishRun(runId)
    }
  }
}
