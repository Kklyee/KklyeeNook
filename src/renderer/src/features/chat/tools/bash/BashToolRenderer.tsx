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
  const error =
    status.type === 'incomplete' && status.error !== undefined
      ? stringifyValue(status.error)
      : undefined
  const { output, stderr, exitCode } = readBashResult(result, error, status.type === 'complete')

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
        <p className="font-mono text-[11px] text-faint-foreground">exit {String(exitCode)}</p>
      )}
    </ToolCard>
  )
}

function readBashResult(result: unknown, error: string | undefined, complete: boolean) {
  const values = isRecord(result) ? result : {}
  const details = isRecord(values.details) ? values.details : {}
  const exitCode =
    values.exitCode ??
    values.exit_code ??
    values.code ??
    details.exitCode ??
    details.exit_code ??
    details.code ??
    error?.match(/Command exited with code (-?\d+)/i)?.[1] ??
    (complete ? 0 : undefined)
  return {
    output: getStringValue(values, 'stdout', 'output') ?? formatToolResult(result),
    stderr: getStringValue(values, 'stderr'),
    exitCode,
  }
}
