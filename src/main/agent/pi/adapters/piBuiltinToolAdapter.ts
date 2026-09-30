import { Type } from 'typebox'
import { SandboxService, toolPermissionResource } from '@/main/sandbox/sandboxService'
import type { ToolAdapterContext } from '@/main/tools/toolRegistry'
import { effectivePermissionMode } from '@/shared/approval/permission'
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'

import type { ToolDefinition } from '@/shared/tool/tool'
import type { ToolRegistration } from '@/main/tools/toolRegistry'
import { ToolRegistry } from '@/main/tools/toolRegistry'

type AnyPiToolDefinition = PiToolDefinition<any, any, any>
type PiToolFactory = (cwd: string) => AnyPiToolDefinition

const PI_BUILTIN_TOOL_FACTORIES: PiToolFactory[] = [
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
]

function toProductDefinition(tool: AnyPiToolDefinition): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
  }
}

export function registerPiBuiltinTools(
  registry: ToolRegistry,
  metadataCwd: string,
  sandbox = new SandboxService(),
): void {
  for (const createTool of PI_BUILTIN_TOOL_FACTORIES) {
    const tool = createTool(metadataCwd)
    const registration: ToolRegistration<AnyPiToolDefinition> = {
      definition: toProductDefinition(tool),
      adapter: { runtime: 'pi', create: (context) => secureTool(createTool, context, sandbox) },
    }
    registry.register(registration)
  }
}

function secureTool(
  createTool: PiToolFactory,
  context: ToolAdapterContext,
  sandbox: SandboxService,
): AnyPiToolDefinition {
  const tool = createTool(context.cwd ?? '')
  const executionContext = context.executionContext ?? { conversationId: '' }
  const mode = effectivePermissionMode(executionContext.mode, Boolean(executionContext.workspace))
  return {
    ...tool,
    ...(tool.name === 'bash'
      ? {
          parameters: Type.Object({
            ...tool.parameters.properties,
            cwd: Type.Optional(
              Type.String({
                description: 'Explicit command working directory; required without a workspace',
              }),
            ),
          }),
        }
      : {}),
    async execute(toolCallId, input, signal, onUpdate, ...rest) {
      const args = input as Record<string, any>
      const request = {
        ...executionContext,
        mode,
        toolName: tool.name,
        resource: toolPermissionResource(tool.name, args),
      }
      if (request.resource.kind === 'path') {
        const path = await sandbox.resolveFile(request, toolCallId)
        return tool.execute(toolCallId, { ...args, path }, signal, onUpdate, ...rest)
      }
      if (request.resource.kind === 'command') {
        const cwd = request.resource.cwd
          ? (
              await sandbox.paths.resolve(
                request.resource.cwd,
                executionContext.workspace?.rootPath,
              )
            ).path
          : executionContext.workspace?.rootPath
        return sandbox.execute(
          request,
          {
            command: args.command,
            cwd,
            signal,
            executeDirect: () =>
              createTool(cwd ?? '').execute(toolCallId, args, signal, onUpdate, ...rest),
          },
          toolCallId,
        )
      }
      return tool.execute(toolCallId, args, signal, onUpdate, ...rest)
    },
  }
}
