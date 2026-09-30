import {
  defineTool,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type, type TSchema } from 'typebox'

import type { ToolRegistration } from '@/main/tools/toolRegistry'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import type {
  McpCallToolResult,
  McpServerConfig,
  McpTool,
} from '@/shared/mcp/mcpServer'

interface McpToolCaller {
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpCallToolResult>
}

type AnyPiToolDefinition = PiToolDefinition<any, any, any>

export function registerPiMcpTool(
  registry: ToolRegistry,
  server: McpServerConfig,
  remoteTool: McpTool,
  connection: McpToolCaller,
): () => void {
  const name = `mcp__${server.id}__${remoteTool.name}`
  const registration: ToolRegistration<AnyPiToolDefinition> = {
    definition: {
      name,
      label: `${server.name}: ${remoteTool.name}`,
      description: remoteTool.description ?? remoteTool.name,
      parameters: remoteTool.inputSchema,
      origin: {
        kind: 'mcp',
        serverId: server.id,
        serverName: server.name,
        remoteName: remoteTool.name,
      },
    },
    adapter: {
      runtime: 'pi',
      create: () => createPiTool(server, remoteTool, connection, name),
    },
  }
  return registry.register(registration)
}

function createPiTool(
  server: McpServerConfig,
  remoteTool: McpTool,
  connection: McpToolCaller,
  name: string,
): AnyPiToolDefinition {
  const parameters = Type.Unsafe<TSchema>(remoteTool.inputSchema as TSchema)
  return defineTool({
    name,
    label: `${server.name}: ${remoteTool.name}`,
    description: remoteTool.description ?? remoteTool.name,
    promptSnippet: `Call the ${remoteTool.name} tool from MCP server ${server.name}`,
    parameters,
    async execute(_toolCallId, args, signal) {
      const result = await connection.callTool(remoteTool.name, args, signal)
      const content = result.content.map((block) => {
        if (block.type === 'text' && typeof block.text === 'string') {
          return { type: 'text' as const, text: block.text }
        }
        if (
          block.type === 'image' &&
          typeof block.data === 'string' &&
          typeof block.mimeType === 'string'
        ) {
          return { type: 'image' as const, data: block.data, mimeType: block.mimeType }
        }
        return { type: 'text' as const, text: JSON.stringify(block) }
      })
      if (result.isError) {
        const message = result.content
          .map((block) =>
            block.type === 'text' && typeof block.text === 'string' ? block.text : '[Image]',
          )
          .join('\n')
        throw new Error(message)
      }
      if (content.length === 0 && result.structuredContent !== undefined) {
        content.push({ type: 'text', text: JSON.stringify(result.structuredContent) })
      }
      return {
        content,
        details: {
          serverId: server.id,
          serverName: server.name,
          remoteName: remoteTool.name,
        },
      }
    },
  })
}
