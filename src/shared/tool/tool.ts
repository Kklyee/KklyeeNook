export interface ToolDefinition {
  name: string
  label: string
  description: string
  parameters: unknown
  origin?: {
    kind: 'mcp'
    serverId: string
    serverName: string
    remoteName: string
  }
}

export interface ToolCall {
  id: string
  toolName: string
  args: unknown
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  output: unknown
  success: boolean
}
