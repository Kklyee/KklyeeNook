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
  stringifyValue,
} from '../toolUtils'

export const ShellToolRenderer: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const values = isRecord(args) ? args : {}
  const command = getStringValue(values, 'command') ?? ''
  const statusError =
    status.type === 'incomplete' && status.error !== undefined
      ? stringifyValue(status.error)
      : undefined
  const { output, stderr, exitCode, error, shell } = readShellResult(result, statusError)

  return (
    <ToolCard toolName="bash" label="Shell" summary={command} status={status}>
      {shell && <p className="font-mono text-[11px] text-faint-foreground">{shell}</p>}
      {command && (
        <ToolDetailSection label="Command">
          <pre className={toolCodeClassName}>{command}</pre>
        </ToolDetailSection>
      )}
      {output && (
        <ToolDetailSection label="stdout">
          <pre className={toolCodeClassName}>{output}</pre>
        </ToolDetailSection>
      )}
      {stderr && (
        <ToolDetailSection label="stderr">
          <pre className={toolCodeClassName}>{stderr}</pre>
        </ToolDetailSection>
      )}
      {error && (
        <ToolDetailSection label="Error">
          <pre className={cn(toolCodeClassName, 'text-danger')}>{error}</pre>
        </ToolDetailSection>
      )}
      {exitCode !== undefined && (
        <p className="font-mono text-[11px] text-faint-foreground">exit {String(exitCode)}</p>
      )}
    </ToolCard>
  )
}

function readShellResult(result: unknown, statusError: string | undefined) {
  const values = isRecord(result) ? result : {}
  const metadata = isRecord(values.details) ? values.details : {}
  const details = isRecord(metadata.details) ? metadata.details : metadata
  const failure = isRecord(values.error) ? values.error : isRecord(metadata.error) ? metadata.error : {}
  const error = getStringValue(failure, 'message') ?? statusError
  const exitCode =
    values.exitCode ??
    values.exit_code ??
    values.code ??
    details.exitCode ??
    details.exit_code ??
    details.code ??
    error?.match(/Command exited with code (-?\d+)/i)?.[1]
  const failed = error !== undefined || (typeof exitCode === 'number' && exitCode !== 0)
  const output = getStringValue(values, 'stdout', 'output') ?? getStringValue(details, 'stdout') ?? (typeof details.stdout === 'string' ? '' : formatToolResult(result))
  const stderr = getStringValue(values, 'stderr') ?? getStringValue(details, 'stderr')
  const failureText = failed
    ? (exitCode === undefined ? error : stderr || output || error) ?? formatToolResult(result)
    : undefined
  return {
    output,
    stderr,
    exitCode,
    error: failureText === undefined ? undefined : failureText.replace(/\n?Command exited with code -?\d+\s*$/i, '').trim() || 'Command failed',
    shell: getStringValue(details, 'shell'),
  }
}
