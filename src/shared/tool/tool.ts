export interface ToolDefinition {
  name: string
  label: string
  description: string
  parameters: unknown
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
