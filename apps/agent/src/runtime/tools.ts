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
import type { PermissionRequest } from '@kklyeenook/shared/approval/permission'
import { effectivePermissionMode } from '@kklyeenook/shared/approval/permission'
import type { ToolCall, ToolExecutionResult } from '@kklyeenook/shared/tool/tool'
import type { ToolAdapterContext, ToolRegistry } from '../tools/toolRegistry'
import type { ToolResultRetentionPolicy } from '../tools/toolResultRetentionPolicy'
import type { ExecutableToolContext } from '../tools/executable-tool'
import { SandboxService, toolPermissionResource } from '../sandbox/sandbox-service'
import { ToolExecutionHarness } from './tool-execution-harness'
import { AgentApprovals } from './approvals'
import type { RunResources } from './run-resources'

type ExecutableTool = {
  execute(
    id: string,
    args: unknown,
    signal?: AbortSignal,
    onUpdate?: (result: ToolExecutionResult) => void,
    context?: ExecutableToolContext,
  ): Promise<unknown>
}

type ResolveContext = (
  conversationId: ConversationId,
  context: Context,
  toolName?: string,
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

export class AgentTools {
  readonly approvals: AgentApprovals

  constructor(
    private readonly registry: ToolRegistry,
    private readonly sandbox: SandboxService,
    private readonly retention: ToolResultRetentionPolicy,
    private readonly resolveContext: ResolveContext,
    private readonly resources?: RunResources,
  ) {
    this.approvals = new AgentApprovals(async (call, api, context) => {
      const adapter = await this.resolveContext(api.conversationId, context, call.name)
      const request = permission(
        { id: call.id, toolName: call.name, args: call.arguments },
        adapter,
      )
      const decision = await this.sandbox.policy.evaluate(request)
      if (decision.outcome === 'deny') return { block: decision.reason }
      if (decision.outcome === 'allow') return undefined
      return {
        request: copyJson({
          permission: request,
          requestedMode: decision.requestedMode,
        }) as JsonObject,
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
      tools: this.registry
        .list()
        .map((definition) =>
          defineTool({
            name: definition.name,
            description: definition.description,
            parameters: definition.inputSchema as TSchema,
            replay: definition.replay ?? 'unsafe',
            execute: async (args, api, context) =>
              this.execute(definition.name, args, api, context),
          }),
        ),
    })
  }

  private async execute(name: string, args: unknown, api: ToolExecutionApi, context: Context) {
    const adapter = await this.resolveContext(api.conversationId, context, name)
    const runId = this.resources
      ? await this.resources.acquire(api.conversationId, context)
      : `durable:${api.conversationId}:${api.taskId}`
    const call = { id: `${api.taskId}:${api.callId}`, toolName: name, args }
    const harness = new ToolExecutionHarness(
      this.registry,
      this.sandbox,
      this.retention,
      async (_call, decision) =>
        this.approvals.authorized(
          api.conversationId,
          api.taskId,
          { id: api.callId, name, arguments: args as JsonObject, type: 'toolCall' },
          {
            request: copyJson({
              permission: permission(call, adapter),
              requestedMode: decision.requestedMode,
            }) as JsonObject,
            reason: decision.reason,
          },
          context,
        ),
      async () => {
        const current = await this.resolveContext(api.conversationId, context, name)
        if (current.executionContext?.mode !== adapter.executionContext?.mode) throw new Error('Permission changed while awaiting execution; submit again')
      },
    )
    const [tool] = this.registry.resolve<ExecutableTool>([name], {
      ...adapter,
      getRunId: () => runId,
    })
    try {
      const result = await harness.execute(
        runId,
        call,
        adapter,
        (input, signal) =>
          tool.execute(api.callId, input, signal, (update) => {
            if (signal.aborted) return
            for (const part of update.content ?? []) if (part.type === 'text') api.output(part.text)
          }, { api }),
        context.abortSignal,
      )
      const { content, toolCallId: _id, toolName: _name, ...details } = result
      return {
        content,
        isError: result.status === 'error',
        details: copyJson(details, { omitUndefinedProperties: true }),
      }
    } finally {
      if (!this.resources) await this.sandbox.finishRun(runId)
    }
  }
}
