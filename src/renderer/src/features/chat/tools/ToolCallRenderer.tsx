import type { ToolCallMessagePartComponent } from '@assistant-ui/react'
import { useState } from 'react'

import { ToolCall } from '../../../components/assistant-ui/elements/tool-call'
import {
  SubagentProgress,
  type SubagentProgressStatus,
} from '../../../components/assistant-ui/elements/subagent-progress.aui'
import { useAgentRunFocus } from '../../runs/AgentRunFocusContext'

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
  return function ToolCallRenderer({ args, argsText, result, status }) {
    const [open, setOpen] = useState(true)

    return (
      <div className="flex flex-col gap-2">
        <ToolCall
          label={label}
          activeLabel={activeLabel}
          query={getQuery(args)}
          request={argsText}
          result={formatToolResult(result)}
          running={status.type === 'running'}
          completed={status.type === 'complete'}
          open={open}
          onOpenChange={setOpen}
          className="max-w-none"
        />
      </div>
    )
  }
}

type DelegateTaskArgs = { task?: string }

interface DelegateTaskState {
  runId?: string
  name?: string
  task?: string
  status?: SubagentProgressStatus
  summary?: string
  result?: string
}

export function parseDelegateTaskState(value: unknown): DelegateTaskState | undefined {
  const text = typeof value === 'string' ? value : formatToolResult(value)
  if (!text) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) return undefined
    return {
      ...(typeof parsed.runId === 'string' ? { runId: parsed.runId } : {}),
      ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
      ...(typeof parsed.task === 'string' ? { task: parsed.task } : {}),
      ...(parsed.status === 'running' ||
      parsed.status === 'completed' ||
      parsed.status === 'failed' ||
      parsed.status === 'aborted'
        ? { status: parsed.status }
        : {}),
      ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {}),
      ...(typeof parsed.result === 'string' ? { result: parsed.result } : {}),
    }
  } catch {
    return undefined
  }
}

export function DelegateTaskToolCall({
  args,
  result,
  status,
}: {
  args: DelegateTaskArgs
  result?: unknown
  status: { type: string }
}) {
  const { focusRun } = useAgentRunFocus()
  const progress = parseDelegateTaskState(result)
  const task = progress?.task ?? args.task ?? '未命名任务'
  const runId = progress?.runId
  const progressStatus = progress?.status
  const displayStatus: SubagentProgressStatus =
    progressStatus ??
    (status.type === 'running' ? 'running' : status.type === 'complete' ? 'completed' : 'failed')
  const summary =
    progress?.summary ??
    (displayStatus === 'running' ? '正在启动子 Agent' : progress?.result) ??
    (displayStatus === 'failed' ? '子 Agent 执行失败' : undefined)

  return (
    <SubagentProgress
      name={progress?.name ?? '子 Agent'}
      task={task}
      status={displayStatus}
      summary={summary}
      runId={runId}
      onOpen={runId ? () => focusRun(runId) : undefined}
    />
  )
}
