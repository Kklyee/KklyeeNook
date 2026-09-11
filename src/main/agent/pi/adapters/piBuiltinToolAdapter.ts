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

export function registerPiBuiltinTools(registry: ToolRegistry, metadataCwd: string): void {
  for (const createTool of PI_BUILTIN_TOOL_FACTORIES) {
    const tool = createTool(metadataCwd)
    const registration: ToolRegistration<AnyPiToolDefinition> = {
      definition: toProductDefinition(tool),
      adapter: { runtime: 'pi', create: ({ cwd }) => createTool(cwd) },
    }
    registry.register(registration)
  }
}
