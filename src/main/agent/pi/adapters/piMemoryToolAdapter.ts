import {
  defineTool,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import type { AgentMemoryRepo } from '@/main/db/repositories/memoryRepo'
import type { ToolRegistration } from '@/main/tools/toolRegistry'
import { ToolRegistry } from '@/main/tools/toolRegistry'

const memorySchema = Type.Object({
  scope: Type.Union([
    Type.Literal('global', { description: 'Available in every workspace' }),
    Type.Literal('workspace', { description: 'Available only in the current workspace' }),
  ]),
  content: Type.String({ description: 'One concise, durable fact or instruction to remember' }),
})

export function createSaveMemoryToolDefinition(
  repo: AgentMemoryRepo,
  workspaceId?: string,
): PiToolDefinition<typeof memorySchema> {
  return defineTool({
    name: 'save_memory',
    label: 'Save memory',
    description:
      'Save one explicit, concise piece of long-term information for future runs. Use this only for durable workspace facts or user instructions, never for an entire conversation or temporary task state.',
    promptSnippet: 'Save one explicit long-term fact or instruction for future runs',
    promptGuidelines: [
      'Only save information that will remain useful across future sessions.',
      'Prefer workspace scope for repository-specific facts and global scope for information that applies everywhere.',
      'Do not save chat transcripts, temporary task details, secrets, or user profiles.',
    ],
    parameters: memorySchema,
    async execute(_toolCallId, params) {
      const memory = await repo.create({
        scope: params.scope,
        content: params.content,
        ...(params.scope === 'workspace' ? { workspaceId } : {}),
      })
      return {
        content: [{ type: 'text', text: `Saved ${memory.scope} memory.` }],
        details: { memory },
      }
    },
  })
}

export function registerPiMemoryTool(
  registry: ToolRegistry,
  repo: AgentMemoryRepo,
  metadataCwd?: string,
): void {
  const tool = createSaveMemoryToolDefinition(repo, metadataCwd)
  const registration: ToolRegistration<typeof tool> = {
    definition: {
      name: tool.name,
      label: tool.label,
      description: tool.description,
      inputSchema: tool.parameters,
    },
    adapter: { runtime: 'pi', create: ({ executionContext }) => createSaveMemoryToolDefinition(repo, executionContext?.workspaceId) },
  }
  registry.register(registration)
}
