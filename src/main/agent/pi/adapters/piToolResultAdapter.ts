import { Type, type TSchema } from 'typebox'
import { defineTool } from '@earendil-works/pi-coding-agent'
import type { ToolRegistry } from '@/main/tools/toolRegistry'
import { ToolResultStore } from '@/main/tools/toolResultStore'
import type { ReadToolResultInput } from '@/shared/tool/tool'

export function registerPiToolResultTool(registry: ToolRegistry, store: ToolResultStore): void {
  const inputSchema = Type.Object({
    resultRef: Type.String({ pattern: '^tool-result://[^/]+/[^/]+$' }),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 * 1024 })),
  })
  const definition = {
    name: 'read_tool_result',
    label: 'Read tool result',
    description:
      'Read a complete retained tool result as JSON in pages. offset and limit count characters, starting at zero. Continue using nextOffset while hasMore is true.',
    inputSchema,
  }
  registry.register({
    definition,
    adapter: {
      runtime: 'pi',
      create: () =>
        defineTool({
          ...definition,
          parameters: inputSchema as TSchema,
          async execute(_id, input) {
            const page = await store.read(input as ReadToolResultInput)
            return {
              content: [{ type: 'text', text: page.text }],
              details: { ...page, text: undefined },
            }
          },
        }),
    },
  })
}
