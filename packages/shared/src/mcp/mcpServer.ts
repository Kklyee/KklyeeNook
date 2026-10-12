export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio' | 'http'
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  disabledTools?: string[]
  url?: string
  shared?: boolean
  requiresCredentials?: boolean
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
  outputSchema?: unknown
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
