import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import {
  ToolCard,
  ToolDetailSection,
  toolCodeClassName,
} from '@/renderer/src/components/assistant-ui/elements/tool-call'
import { cn } from '@/renderer/src/lib/utils'
import {
  formatToolResult,
  getStringValue,
  isRecord,
  previewText,
  stringifyValue,
} from '../toolUtils'

export const BashToolRenderer: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const values = isRecord(args) ? args : {}
  const command = getStringValue(values, 'command') ?? ''
  const output = isRecord(result)
    ? (getStringValue(result, 'stdout', 'output') ?? formatToolResult(result))
    : formatToolResult(result)
  const stderr = isRecord(result) ? getStringValue(result, 'stderr') : undefined
  const resultDetails = isRecord(result) && isRecord(result.details) ? result.details : {}
  const error =
    status.type === 'incomplete' && status.error !== undefined
      ? stringifyValue(status.error)
      : undefined
  const errorExitCode = error?.match(/Command exited with code (-?\d+)/i)?.[1]
  const exitCode = isRecord(result)
    ? (result.exitCode ??
      result.exit_code ??
      result.code ??
      resultDetails.exitCode ??
      resultDetails.exit_code ??
      resultDetails.code ??
      errorExitCode ??
      (status.type === 'complete' ? 0 : undefined))
    : (errorExitCode ?? (status.type === 'complete' ? 0 : undefined))

  return (
    <ToolCard toolName="bash" label="Bash" summary={command} status={status}>
      {command && (
        <ToolDetailSection label="Command">
          <pre className={toolCodeClassName}>$ {command}</pre>
        </ToolDetailSection>
      )}
      {output && (
        <ToolDetailSection label="stdout">
          <pre className={toolCodeClassName}>{previewText(output, 24, 2400)}</pre>
        </ToolDetailSection>
      )}
      {stderr && (
        <ToolDetailSection label="stderr">
          <pre className={toolCodeClassName}>{previewText(stderr, 16, 1200)}</pre>
        </ToolDetailSection>
      )}
      {error && (
        <ToolDetailSection label="Error">
          <pre className={cn(toolCodeClassName, 'text-danger')}>{previewText(error, 24, 2400)}</pre>
        </ToolDetailSection>
      )}
      {exitCode !== undefined && (
        <p className="font-mono text-[11px] text-text-faint">exit {String(exitCode)}</p>
      )}
    </ToolCard>
  )
}
