import type { ToolCallMessagePartComponent } from '@assistant-ui/react'
import { useState } from 'react'

import { ToolCall } from '../../../components/assistant-ui/elements/tool-call'
import { ToolFallback } from '../../../components/assistant-ui/elements/tool-fallback.aui'

type ToolArgs = Record<string, unknown>

type ToolCallRendererOptions<TArgs extends ToolArgs> = {
  label: string
  activeLabel: string
  getQuery: (args: TArgs) => string
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function formatToolResult(result: unknown): string {
  if (result === undefined) return ''
  if (!isRecord(result) || !('content' in result)) return stringifyValue(result)

  const { content } = result
  if (!Array.isArray(content)) return stringifyValue(content)

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (isRecord(part) && typeof part.text === 'string') return part.text
      return stringifyValue(part)
    })
    .join('\n')
}

export function createToolCallRenderer<TArgs extends ToolArgs>({
  label,
  activeLabel,
  getQuery,
}: ToolCallRendererOptions<TArgs>): ToolCallMessagePartComponent<TArgs, unknown> {
  return function ToolCallRenderer({
    args,
    argsText,
    result,
    status,
    addResult,
    resume,
    interrupt,
    approval,
    respondToApproval,
  }) {
    const [open, setOpen] = useState(false)

    return (
      <div className="flex flex-col gap-2">
        <ToolCall
          label={label}
          activeLabel={activeLabel}
          query={getQuery(args)}
          request={argsText}
          result={formatToolResult(result)}
          running={status.type === 'running'}
          open={open}
          onOpenChange={setOpen}
          className="max-w-none"
        />
        {status.type === 'requires-action' && (
          <ToolFallback.Approval
            addResult={addResult}
            resume={resume}
            interrupt={interrupt}
            approval={approval}
            respondToApproval={respondToApproval}
            status={status}
          />
        )}
      </div>
    )
  }
}
