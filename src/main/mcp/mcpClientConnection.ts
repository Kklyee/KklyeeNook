import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

import type {
  McpCallToolResult,
  McpServerConfig,
  McpTool,
} from '@/shared/mcp/mcpServer'

const CONNECTION_TIMEOUT_MS = 15_000

export class McpClientConnection {
  private client: Client | undefined
  private transport: StdioClientTransport | undefined
  private closing = false

  constructor(
    private readonly config: McpServerConfig,
    private readonly onClose: (error?: Error) => void = () => undefined,
    private readonly onToolsChanged: (tools: McpTool[]) => void = () => undefined,
  ) {}

  async connect(): Promise<void> {
    const client = new Client(
      { name: 'kklyeenook-agent', version: '1.0.0' },
      {
        listChanged: {
          tools: {
            onChanged: (error, tools) => {
              if (error) this.onClose(error)
              else if (tools && !this.closing) this.onToolsChanged(tools)
            },
          },
        },
      },
    )
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: this.config.env,
      cwd: this.config.cwd,
      stderr: 'inherit',
    })
    this.client = client
    this.transport = transport
    client.onclose = () => {
      if (!this.closing) this.onClose()
    }

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('MCP server connection timed out.')),
            CONNECTION_TIMEOUT_MS,
          )
        }),
      ])
    } catch (error) {
      await this.close()
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.client) throw new Error('MCP client is not connected.')
    const result = await this.client.listTools(undefined, { timeout: CONNECTION_TIMEOUT_MS })
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
    }))
  }

  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpCallToolResult> {
    if (!this.client) throw new Error('MCP client is not connected.')
    const result = await this.client.callTool(
      {
        name,
        arguments: isRecord(args) ? args : {},
      },
      { signal },
    )
    return result as McpCallToolResult
  }

  async close(): Promise<void> {
    this.closing = true
    const client = this.client
    const transport = this.transport
    this.client = undefined
    this.transport = undefined
    await client?.close().catch(() => undefined)
    await transport?.close().catch(() => undefined)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
