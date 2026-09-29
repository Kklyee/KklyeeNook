import { useState } from 'react'
import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import {
  ToolCard,
  ToolDetailSection,
  toolCodeClassName,
} from '@/renderer/src/components/assistant-ui/elements/tool-call'
import {
  SubagentProgress,
  type SubagentProgressStatus,
} from '@/renderer/src/components/assistant-ui/elements/subagent-progress.aui'
import { SUBAGENT_AVATARS, type SubagentAvatar } from '@/shared/agent/delegateTask'
import { useAgentRunFocus } from '@/renderer/src/features/runs/AgentRunFocusContext'
import { formatToolResult, getStringValue, isRecord, previewText } from '../toolUtils'

type SubagentToolState = {
  runId?: string
  name?: string
  avatar?: SubagentAvatar
  task?: string
  status?: 'running' | 'completed' | 'failed' | 'aborted'
  summary?: string
  result?: string
}

function parseSubagentState(value: unknown): SubagentToolState | undefined {
  let parsed: unknown = value
  if (isRecord(value) && isRecord(value.details)) {
    parsed = value.details
  } else if (typeof value === 'string' || (isRecord(value) && 'content' in value)) {
    try {
      parsed = JSON.parse(typeof value === 'string' ? value : formatToolResult(value))
    } catch {
      return undefined
    }
  }
  if (!isRecord(parsed)) return undefined

  return {
    ...(typeof parsed.runId === 'string' ? { runId: parsed.runId } : {}),
    ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
    ...(typeof parsed.avatar === 'string' &&
    (SUBAGENT_AVATARS as readonly string[]).includes(parsed.avatar)
      ? { avatar: parsed.avatar as SubagentAvatar }
      : {}),
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
}

export const SubagentToolRenderer: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const { focusRun } = useAgentRunFocus()
  const values = isRecord(args) ? args : {}
  const inputTask = getStringValue(values, 'task')
  const progress = parseSubagentState(result)
  const task = progress?.task ?? inputTask ?? 'Unnamed task'
  const childResult = progress?.summary ?? progress?.result
  const runId = progress?.runId
  const displayStatus: SubagentProgressStatus =
    progress?.status ??
    (status.type === 'running' ? 'running' : status.type === 'complete' ? 'completed' : 'failed')
  const [open, setOpen] = useState(false)

  return (
    <ToolCard
      toolName="delegate_task"
      label={progress?.name ?? 'Subagent'}
      summary={task}
      status={status}
      open={open}
      onOpenChange={setOpen}
    >
      <ToolDetailSection label="Subagent">
        <SubagentProgress
          name={progress?.name ?? 'Subagent'}
          avatar={progress?.avatar}
          task={task}
          status={displayStatus}
          runId={runId}
          onOpen={runId ? () => focusRun(runId) : undefined}
        />
      </ToolDetailSection>
      {childResult && (
        <ToolDetailSection label="Result">
          <pre className={toolCodeClassName}>{previewText(childResult, 16, 1600)}</pre>
        </ToolDetailSection>
      )}
    </ToolCard>
  )
}
