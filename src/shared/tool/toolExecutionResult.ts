import type { ToolContent, ToolErrorCode, ToolExecutionResult, ToolResult } from './tool'

export function toolError(code: ToolErrorCode, message: string): ToolExecutionResult {
  return {
    status: 'error',
    content: [
      {
        type: 'text',
        text: code === 'INVALID_ARGUMENTS' ? `Invalid tool arguments: ${message}` : message,
      },
    ],
    error: { code, message },
  }
}

export function normalizeToolResult(raw: unknown, isError = false): ToolExecutionResult {
  const value =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined
  const metadata = value?.details as Partial<ToolExecutionResult> | undefined
  if (value?.status === 'success' || value?.status === 'error') return raw as ToolExecutionResult
  if (metadata?.status === 'success' || metadata?.status === 'error')
    return { ...metadata, content: value!.content as ToolContent[] } as ToolExecutionResult
  const content: ToolContent[] = Array.isArray(value?.content)
    ? value.content.map((block) => {
        if (block.type === 'text' && typeof block.text === 'string')
          return { type: 'text', text: block.text }
        if (
          block.type === 'image' &&
          typeof block.data === 'string' &&
          typeof block.mimeType === 'string'
        )
          return { type: 'image', data: block.data, mimeType: block.mimeType }
        return { type: 'text', text: JSON.stringify(block) }
      })
    : [{ type: 'text', text: typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? '') }]
  if (!content.length && value?.structuredContent !== undefined)
    content.push({ type: 'text', text: JSON.stringify(value.structuredContent) })
  const failed = isError || value?.isError === true
  return {
    status: failed ? 'error' : 'success',
    content,
    ...(value?.details !== undefined || value?.structuredContent !== undefined
      ? { details: value.details ?? value.structuredContent }
      : {}),
    ...(failed
      ? {
          error: {
            code: 'EXECUTION_ERROR',
            message: content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('\n'),
          },
        }
      : {}),
  }
}

export class ToolExecutionError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export function migrateToolResult(value: ToolResult): ToolResult {
  if (value.status) return value
  const legacy = value as unknown as {
    toolCallId: string
    toolName: string
    output: unknown
    success: boolean
  }
  return {
    ...normalizeToolResult(legacy.output, !legacy.success),
    toolCallId: legacy.toolCallId,
    toolName: legacy.toolName,
  }
}
