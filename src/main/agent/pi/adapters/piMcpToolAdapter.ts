import type { TSchema } from 'typebox'

import type { ToolRegistration } from '@/main/tools/toolRegistry'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import type { ExecutableTool } from '@/main/tools/executable-tool'
import { defineExecutableTool } from '@/main/tools/executable-tool'
import type {
  McpCallToolResult,
  McpServerConfig,
  McpTool,
} from '@/shared/mcp/mcpServer'

interface McpToolCaller {
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpCallToolResult>
}

type AnyPiToolDefinition = ExecutableTool<TSchema, any>

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
      inputSchema: remoteTool.inputSchema,
      ...(remoteTool.outputSchema !== undefined ? { outputSchema: remoteTool.outputSchema } : {}),
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
  const parameters = remoteTool.inputSchema as TSchema
  return defineExecutableTool({
    name,
    label: `${server.name}: ${remoteTool.name}`,
    description: remoteTool.description ?? remoteTool.name,
    promptSnippet: `Call the ${remoteTool.name} tool from MCP server ${server.name}`,
    parameters,
    async execute(_toolCallId, args, signal) {
      const result = await connection.callTool(remoteTool.name, args, signal)
      return {
        ...result,
        details: {
          serverId: server.id,
          serverName: server.name,
          remoteName: remoteTool.name,
          ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
        },
      } as any
    },
  })
}
