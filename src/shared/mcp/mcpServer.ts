export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  disabledTools?: string[]
}

export interface McpToolState {
  name: string
  description?: string
  enabled: boolean
}

export interface McpServerState {
  serverId: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  toolCount: number
  tools?: McpToolState[]
  error?: string
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: unknown
}

export interface McpCallToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: string; [key: string]: unknown }
  >
  isError?: boolean
  structuredContent?: unknown
}
