import { Compile } from 'typebox/compile'
import type { TSchema } from 'typebox'
import type { PermissionDecision, PermissionRequest } from '@/shared/approval/permission'
import { effectivePermissionMode } from '@/shared/approval/permission'
import type { ToolCall, ToolExecutionResult, ToolResult } from '@/shared/tool/tool'
import {
  normalizeToolResult,
  toolError,
  ToolExecutionError,
} from '@/shared/tool/toolExecutionResult'
import { SandboxService, toolPermissionResource } from '@/main/sandbox/sandboxService'
import type { SandboxExecutionResult } from '@/main/sandbox/sandboxBackend'
import type { ToolAdapterContext, ToolRegistry } from '@/main/tools/toolRegistry'
import type { ToolResultRetentionPolicy } from '@/main/tools/toolResultRetentionPolicy'

type ExecuteTool = (args: unknown, signal: AbortSignal) => Promise<unknown>
type ApproveTool = (
  call: ToolCall,
  decision: Extract<PermissionDecision, { outcome: 'ask' }>,
  signal: AbortSignal,
) => Promise<boolean>

export class ToolExecutionHarness {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly sandbox: SandboxService,
    private readonly retention: ToolResultRetentionPolicy,
    private readonly approve?: ApproveTool,
  ) {}

  async execute(
    runId: string,
    call: ToolCall,
    context: ToolAdapterContext,
    execute: ExecuteTool,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const definition = this.registry.get(call.toolName)
    let result: ToolExecutionResult
    if (!definition) {
      result = toolError('UNKNOWN_TOOL', `Unknown tool: ${call.toolName}`)
    } else {
      const validator = Compile(definition.inputSchema as TSchema)
      if (!validator.Check(call.args)) {
        const message = validator
          .Errors(call.args)
          .map((error) => {
            const path = error.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'arguments'
            return `${path} ${error.message}`
          })
          .join('; ')
        result = toolError('INVALID_ARGUMENTS', message)
      } else {
        const controller = new AbortController()
        const onAbort = () =>
          controller.abort(new ToolExecutionError('ABORTED', 'Tool execution aborted'))
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) onAbort()
        const args = call.args as Record<string, unknown>
        const timeoutMs =
          definition.timeoutMs ??
          (call.toolName === 'bash' && typeof args.timeout === 'number'
            ? args.timeout * 1000
            : undefined)
        const timer =
          timeoutMs === undefined
            ? undefined
            : setTimeout(
                () =>
                  controller.abort(
                    new ToolExecutionError('TIMEOUT', `Tool timed out after ${timeoutMs} ms`),
                  ),
                timeoutMs,
              )
        let rejectAbort: () => void = () => undefined
        try {
          const aborted = new Promise<never>((_resolve, reject) => {
            rejectAbort = () => reject(controller.signal.reason)
            controller.signal.addEventListener('abort', rejectAbort, { once: true })
            if (controller.signal.aborted) rejectAbort()
          })
          const execution = async () => {
            controller.signal.throwIfAborted()
            const executionContext = context.executionContext ?? { conversationId: '' }
            const request: PermissionRequest = {
              ...executionContext,
              mode: effectivePermissionMode(
                executionContext.mode,
                Boolean(executionContext.workspace),
              ),
              toolName: call.toolName,
              resource: toolPermissionResource(call.toolName, call.args),
            }
            const decision = await this.sandbox.policy.evaluate(request)
            controller.signal.throwIfAborted()
            if (decision.outcome === 'deny')
              throw new ToolExecutionError('PERMISSION_DENIED', decision.reason)
            if (decision.outcome === 'ask') {
              const approved = await this.approve?.(call, decision, controller.signal)
              controller.signal.throwIfAborted()
              if (!approved) throw new ToolExecutionError('PERMISSION_DENIED', '用户拒绝本次执行')
              this.sandbox.elevate(call.id, request, decision.requestedMode)
            }
            if (request.resource.kind === 'path') {
              const path = await this.sandbox.resolveFile(request, call.id)
              controller.signal.throwIfAborted()
              return execute({ ...args, path }, controller.signal)
            }
            if (request.resource.kind === 'command') {
              const cwd = request.resource.cwd
                ? (
                    await this.sandbox.paths.resolve(
                      request.resource.cwd,
                      executionContext.workspace?.rootPath,
                    )
                  ).path
                : executionContext.workspace?.rootPath
              controller.signal.throwIfAborted()
              return this.sandbox.execute(
                request,
                {
                  command: request.resource.command,
                  runId,
                  cwd,
                  signal: controller.signal,
                  executeDirect: () =>
                    execute({ ...args, cwd }, controller.signal) as Promise<SandboxExecutionResult>,
                },
                call.id,
              )
            }
            await this.sandbox.authorize(request, call.id)
            controller.signal.throwIfAborted()
            return execute(call.args, controller.signal)
          }
          result = normalizeToolResult(await Promise.race([execution(), aborted]))
        } catch (error) {
          const failure = controller.signal.aborted ? controller.signal.reason : error
          const code =
            failure instanceof ToolExecutionError
              ? failure.code
              : failure instanceof Error && failure.name === 'AbortError'
                ? 'ABORTED'
                : failure instanceof Error && failure.name === 'TimeoutError'
                  ? 'TIMEOUT'
                  : 'EXECUTION_ERROR'
          result = toolError(code, failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (timer) clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          controller.signal.removeEventListener('abort', rejectAbort)
        }
      }
    }
    return {
      ...(await this.retention.process(runId, call.id, {
        ...result,
        toolCallId: call.id,
        toolName: call.toolName,
      } as ToolResult)),
      toolCallId: call.id,
      toolName: call.toolName,
    }
  }
}
