import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AssistantRuntimeProvider,
  fromThreadMessageLike,
  useAui,
  useExternalStoreRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { ArrowLeftIcon, CircleAlertIcon } from 'lucide-react'

import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import type { AgentRun, AgentRunStatus } from '@/shared/agent/agentRun'
import { cn } from '@/renderer/src/lib/utils'
import { ShimmerLabel } from '@/renderer/src/lib/surfaces'
import { SubagentAvatar } from './subagent-avatar.aui'
import { Thread } from './thread.aui'

type ReadOnlyPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
      argsText: string
      result?: unknown
      isError?: boolean
      approval?: { id: string; prompt?: string; approved?: boolean }
    }

export function SubagentSessionPanel({
  sessionId,
  runId,
  onBack,
}: {
  sessionId: string
  runId: string
  onBack: () => void
}) {
  const runsQuery = useQuery({
    queryKey: ['agent-runs', sessionId, 'subagent-view'],
    queryFn: () => window.api.listAgentRuns({ sessionId }),
    refetchInterval: 500,
  })
  const run = runsQuery.data?.find((candidate) => candidate.id === runId)
  const recordsQuery = useQuery({
    queryKey: ['agent-execution-records', 'subagent-view', runId],
    queryFn: () => window.api.listAgentExecutionRecords({ runId }),
    refetchInterval: run && isActive(run.status) ? 350 : false,
    retry: false,
  })
  const records = recordsQuery.data ?? []
  const task = findTask(records)
  const active = run ? isActive(run.status) : true

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="border-border/60 flex shrink-0 items-center gap-4 border-b px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className="text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          返回对话
        </button>
        <div className="bg-border/60 h-7 w-px" />
        <SubagentAvatar avatar={run?.avatar} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-medium">{run?.displayName ?? '子 Agent'}</h2>
            <StatusBadge status={run?.status} />
          </div>
          <p className="text-foreground/45 mt-1 truncate text-xs">
            {task ?? '正在加载子任务'}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {recordsQuery.isError ? (
          <div className="text-destructive flex items-center gap-2 px-5 py-6 text-xs">
            <CircleAlertIcon className="size-4" />
            无法加载子 Agent 的实时输出
          </div>
        ) : (
          <SubagentThread key={runId} records={records} run={run} active={active} />
        )}
      </div>

      <div className="border-border/60 flex shrink-0 items-center gap-2 border-t px-5 py-2.5 text-[11px] text-foreground/40">
        <span className={cn('size-1.5 rounded-full', active ? 'bg-blue-500' : 'bg-emerald-500')} />
        <ShimmerLabel active={active}>{run ? runStatusLabel(run.status) : '连接中'}</ShimmerLabel>
      </div>
    </div>
  )
}

function SubagentThread({
  records,
  run,
  active,
}: {
  records: readonly AgentExecutionRecord[]
  run?: AgentRun
  active: boolean
}) {
  const aui = useAui()
  const messages = useMemo(() => buildThreadMessages(records, run), [records, run])
  const store = useMemo<ExternalStoreAdapter<ThreadMessageLike>>(
    () => ({
      messages,
      convertMessage: (message, index) =>
        fromThreadMessageLike(
          message,
          message.id ?? `subagent-message-${index}`,
          { type: 'complete', reason: 'unknown' },
        ),
      isRunning: active,
      isLoading: records.length === 0 && active,
      isSendDisabled: true,
      onNew: async () => undefined,
    }),
    [active, messages, records.length],
  )
  const runtime = useExternalStoreRuntime(store)

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <Thread readOnly autoFocus={false} />
    </AssistantRuntimeProvider>
  )
}

function buildThreadMessages(
  records: readonly AgentExecutionRecord[],
  run?: AgentRun,
): readonly ThreadMessageLike[] {
  const ordered = [...records].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)
  const userRecord = ordered.find((record) => record.event.type === 'user_message')
  const parts: ReadOnlyPart[] = []
  const toolParts = new Map<string, Extract<ReadOnlyPart, { type: 'tool-call' }>>()

  for (const record of ordered) {
    const event = record.event
    switch (event.type) {
      case 'thinking_delta':
        appendTextPart(parts, 'reasoning', event.text)
        break
      case 'text_delta':
        appendTextPart(parts, 'text', event.text)
        break
      case 'tool_started': {
        const tool: Extract<ReadOnlyPart, { type: 'tool-call' }> = {
          type: 'tool-call',
          toolCallId: event.call.id,
          toolName: event.call.toolName,
          args: toToolArgs(event.call.args),
          argsText: formatValue(event.call.args),
        }
        toolParts.set(event.call.id, tool)
        parts.push(tool)
        break
      }
      case 'tool_updated': {
        const tool = toolParts.get(event.toolCallId)
        if (tool) tool.result = event.partialResult
        break
      }
      case 'tool_finished': {
        const tool = toolParts.get(event.result.toolCallId)
        if (tool) {
          tool.result = event.result
          tool.isError = event.result.status === 'error'
        }
        break
      }
      case 'approval_required': {
        const tool = toolParts.get(event.call.id)
        if (tool) {
          tool.approval = { id: event.approvalId, prompt: '等待审批' }
        } else {
          const pendingTool: Extract<ReadOnlyPart, { type: 'tool-call' }> = {
            type: 'tool-call',
            toolCallId: event.call.id,
            toolName: event.call.toolName,
            args: toToolArgs(event.call.args),
            argsText: formatValue(event.call.args),
            approval: { id: event.approvalId, prompt: '等待审批' },
          }
          toolParts.set(event.call.id, pendingTool)
          parts.push(pendingTool)
        }
        break
      }
      case 'approval_resolved': {
        const tool = toolParts.get(event.toolCallId)
        if (tool?.approval) {
          tool.approval = { ...tool.approval, approved: event.decision === 'allow' }
        }
        break
      }
      default:
        break
    }
  }

  const messages: ThreadMessageLike[] = []
  if (userRecord?.event.type === 'user_message') {
    messages.push({
      id: `subagent-user-${userRecord.id}`,
      role: 'user',
      content: userRecord.event.text,
      createdAt: new Date(userRecord.timestamp),
    })
  }
  if (parts.length) {
    messages.push({
      id: `subagent-assistant-${run?.id ?? 'run'}`,
      role: 'assistant',
      content: parts as unknown as ThreadMessageLike['content'],
      createdAt: new Date((ordered[0]?.timestamp ?? Date.now()) + 1),
      status: toMessageStatus(run),
    })
  }

  return messages
}

function appendTextPart(parts: ReadOnlyPart[], type: 'text' | 'reasoning', text: string): void {
  const previous = parts.at(-1)
  if (previous?.type === type) {
    previous.text += text
    return
  }
  parts.push({ type, text })
}

function toMessageStatus(run?: AgentRun):
  | { type: 'running' }
  | { type: 'requires-action'; reason: 'tool-calls' }
  | { type: 'complete'; reason: 'stop' | 'unknown' }
  | { type: 'incomplete'; reason: 'cancelled' | 'error'; error?: string } {
  if (!run || run.status === 'running' || run.status === 'created') return { type: 'running' }
  if (run.status === 'waiting') return { type: 'requires-action', reason: 'tool-calls' }
  if (run.status === 'completed') return { type: 'complete', reason: 'stop' }
  if (run.status === 'aborted' || run.status === 'interrupted') {
    return { type: 'incomplete', reason: 'cancelled' }
  }
  return { type: 'incomplete', reason: 'error', error: run.error }
}

function toToolArgs(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function findTask(records: readonly AgentExecutionRecord[]): string | undefined {
  const record = records.find((candidate) => candidate.event.type === 'user_message')
  return record?.event.type === 'user_message' ? record.event.text : undefined
}

function isActive(status: AgentRunStatus): boolean {
  return status === 'created' || status === 'running' || status === 'waiting'
}

function runStatusLabel(status: AgentRunStatus): string {
  if (status === 'waiting') return '等待审批'
  if (status === 'running' || status === 'created') return '执行中'
  if (status === 'completed') return '已完成'
  if (status === 'aborted') return '已中止'
  if (status === 'interrupted') return '已中断'
  return '执行失败'
}

function StatusBadge({ status }: { status?: AgentRunStatus }) {
  if (!status) return null
  return (
    <span className="text-foreground/45 inline-flex items-center gap-1 text-[10px]">
      <span className={cn('size-1.5 rounded-full', isActive(status) ? 'bg-blue-500' : 'bg-emerald-500')} />
      {runStatusLabel(status)}
    </span>
  )
}
