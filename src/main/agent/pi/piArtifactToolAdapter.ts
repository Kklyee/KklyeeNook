import {
  defineTool,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { parseArtifactDraft, type ArtifactDraft } from '@/shared/artifact/artifact'
import type { ToolRegistration } from '@/main/tools/toolRegistry'
import { ToolRegistry } from '@/main/tools/toolRegistry'

const artifactSchema = Type.Object({
  kind: Type.String({ description: 'Artifact kind: code, diff, table, markdown, or file' }),
  title: Type.String({ description: 'Short human-readable artifact title' }),
  targetPath: Type.Optional(
    Type.String({ description: 'Workspace-relative path used only when the user chooses Apply' }),
  ),
  metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
  content: Type.Optional(Type.String({ description: 'Required for code, markdown, and file' })),
  patch: Type.Optional(Type.String({ description: 'Unified diff; required for diff' })),
  columns: Type.Optional(Type.Array(Type.String({ description: 'Required for table' }))),
  rows: Type.Optional(
    Type.Array(Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]))),
  ),
  language: Type.Optional(Type.String()),
  filename: Type.Optional(Type.String({ description: 'Required for file' })),
  mimeType: Type.Optional(Type.String()),
})

export function createArtifactToolDefinition(): PiToolDefinition<
  typeof artifactSchema,
  { artifact: ArtifactDraft }
> {
  return defineTool({
    name: 'create_artifact',
    label: 'Create artifact',
    description:
      'Create a durable, interactive result for the user. Use for code, unified diffs, tables, Markdown documents, and text files that should be opened, copied, applied, or exported separately from chat text.',
    promptSnippet: 'Create a durable code, diff, table, Markdown, or file artifact',
    promptGuidelines: [
      'Use create_artifact when the requested result is reusable or actionable beyond the chat response.',
      'Set targetPath only when applying the artifact to a workspace file is meaningful.',
    ],
    parameters: artifactSchema,
    async execute(_toolCallId, params) {
      const artifact = parseArtifactDraft(params)
      if (!artifact) {
        throw new Error(`Invalid fields for ${params.kind} artifact`)
      }
      return {
        content: [{ type: 'text', text: `Created ${artifact.kind} artifact: ${artifact.title}` }],
        details: { artifact },
      }
    },
  })
}

export function registerPiArtifactTool(registry: ToolRegistry): void {
  const tool = createArtifactToolDefinition()
  const registration: ToolRegistration<typeof tool> = {
    definition: {
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
    },
    adapter: { runtime: 'pi', create: () => createArtifactToolDefinition() },
  }
  registry.register(registration)
}
