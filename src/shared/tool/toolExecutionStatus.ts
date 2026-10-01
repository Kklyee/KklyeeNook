import type { ToolCallMessagePartStatus } from '@assistant-ui/react'

export function resolveToolExecutionStatus(
  status: ToolCallMessagePartStatus,
  isError?: boolean,
  error?: string,
): ToolCallMessagePartStatus {
  return isError
    ? { type: 'incomplete', reason: 'error', error: error || 'Tool execution failed' }
    : status
}
