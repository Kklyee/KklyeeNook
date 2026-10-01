export interface ToolDefinition {
  name: string
  label: string
  description: string
  inputSchema: unknown
  outputSchema?: unknown
  timeoutMs?: number
  origin?: ToolOrigin
}

export interface ToolOrigin {
  kind: 'mcp'
  serverId: string
  serverName: string
  remoteName: string
}

export interface ToolCall {
  id: string
  toolName: string
  args: unknown
}

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export type ToolErrorCode =
  | 'INVALID_ARGUMENTS'
  | 'UNKNOWN_TOOL'
  | 'PERMISSION_DENIED'
  | 'ABORTED'
  | 'TIMEOUT'
  | 'EXECUTION_ERROR'

export interface ToolExecutionResult {
  status: 'success' | 'error'
  content: ToolContent[]
  details?: unknown
  error?: { code: ToolErrorCode; message: string }
  retention?: { truncated: boolean; originalBytes?: number; resultRef?: string }
}

export interface ToolResult extends ToolExecutionResult {
  toolCallId: string
  toolName: string
}

export interface ReadToolResultInput {
  resultRef: string
  offset?: number
  limit?: number
}
