import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleDotIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react'

import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import type { AgentRunStatus } from '@/shared/agent/agentRun'
import { cn } from '@/renderer/src/lib/utils'
import { field, mono, ShimmerLabel } from '@/renderer/src/lib/surfaces'
import { SubagentAvatar } from './subagent-avatar.aui'

type ViewerItem =
  | {
      id: string
      kind: 'user' | 'thinking' | 'assistant' | 'status'
      timestamp: number
      text: string
      status?: 'running' | 'completed' | 'failed'
    }
  | {
      id: string
      kind: 'tool'
      timestamp: number
      toolName: string
      args: unknown
      output?: unknown
      status: 'running' | 'waiting' | 'completed' | 'failed'
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
  const items = useMemo(
    () => buildViewerItems(recordsQuery.data ?? []),
    [recordsQuery.data],
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [items])

  const task = findTask(recordsQuery.data ?? [])
  const active = run ? isActive(run.status) : true
  const latest = items.at(-1)

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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {recordsQuery.isError ? (
          <div className="text-destructive flex items-center gap-2 text-xs">
            <CircleAlertIcon className="size-4" />
            无法加载子 Agent 的实时输出
          </div>
        ) : items.length ? (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <ViewerItemView key={item.id} item={item} active={active && item === latest} />
            ))}
          </div>
        ) : (
          <div className="text-foreground/45 flex items-center gap-2 py-8 text-xs">
            <LoaderCircleIcon className="size-4 animate-spin" />
            子 Agent 正在准备工作环境
          </div>
        )}
      </div>

      <div className="border-border/60 flex shrink-0 items-center gap-2 border-t px-5 py-2.5 text-[11px] text-foreground/40">
        <span className={cn('size-1.5 rounded-full', active ? 'bg-blue-500' : 'bg-emerald-500')} />
        <ShimmerLabel active={active}>{run ? runStatusLabel(run.status) : '连接中'}</ShimmerLabel>
        {latest && latest.kind === 'tool' && <span className="truncate">· {latest.toolName}</span>}
      </div>
    </div>
  )
}

function ViewerItemView({ item, active }: { item: ViewerItem; active: boolean }) {
  if (item.kind === 'tool') {
    const waiting = item.status === 'waiting'
    const running = item.status === 'running' || waiting
    return (
      <div className={cn(field, 'rounded-xl px-3.5 py-3')}>
        <div className="flex items-center gap-2">
          <WrenchIcon className="size-3.5 text-amber-500" />
          <span className="text-xs font-medium">{item.toolName}</span>
          <ToolStatus status={item.status} />
        </div>
        <div className="mt-2 grid gap-2 text-[11px]">
          <ValueBlock label="参数" value={item.args} />
          {item.output !== undefined && <ValueBlock label={waiting ? '审批' : '输出'} value={item.output} />}
          {waiting && <p className="text-amber-500">等待审批后继续执行</p>}
          {running && !waiting && active && (
            <LoaderCircleIcon className="size-3 animate-spin text-blue-500" />
          )}
        </div>
      </div>
    )
  }

  if (item.kind === 'user') {
    return (
      <div className="flex items-start gap-2.5">
        <UserIcon className="mt-0.5 size-4 shrink-0 text-foreground/40" />
        <div className="min-w-0 flex-1 rounded-xl bg-foreground/[0.05] px-3.5 py-2.5 text-xs whitespace-pre-wrap">
          {item.text}
        </div>
      </div>
    )
  }

  if (item.kind === 'thinking') {
    return (
      <div className="flex items-start gap-2.5">
        <CircleDotIcon className="mt-0.5 size-4 shrink-0 text-violet-400" />
        <div className="min-w-0 flex-1 rounded-xl border border-violet-400/15 bg-violet-400/[0.05] px-3.5 py-2.5">
          <p className="mb-1 text-[10px] font-medium text-violet-400">思考</p>
          <p className="text-foreground/65 text-xs whitespace-pre-wrap">
            {item.text}
            {active && <span className="ml-1 inline-block animate-pulse">▋</span>}
          </p>
        </div>
      </div>
    )
  }

  if (item.kind === 'assistant') {
    return (
      <div className="flex items-start gap-2.5">
        <MessageSquareTextIcon className="mt-0.5 size-4 shrink-0 text-blue-400" />
        <div className="min-w-0 flex-1 rounded-xl bg-blue-400/[0.05] px-3.5 py-2.5 text-xs whitespace-pre-wrap">
          {item.text}
          {active && <span className="ml-1 inline-block animate-pulse text-blue-400">▋</span>}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
        item.status === 'failed'
          ? 'bg-destructive/[0.08] text-destructive'
          : 'bg-foreground/[0.04] text-foreground/50',
      )}
    >
      {item.status === 'failed' ? (
        <CircleAlertIcon className="size-3.5" />
      ) : item.status === 'running' ? (
        <LoaderCircleIcon className="size-3.5 animate-spin text-blue-500" />
      ) : (
        <CheckIcon className="size-3.5 text-emerald-500" />
      )}
      <span className="whitespace-pre-wrap">{item.text}</span>
    </div>
  )
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

function ToolStatus({ status }: { status: Extract<ViewerItem, { kind: 'tool' }>['status'] }) {
  if (status === 'waiting') return <span className="ml-auto text-[10px] text-amber-500">等待审批</span>
  if (status === 'running') return <LoaderCircleIcon className="ml-auto size-3 animate-spin text-blue-500" />
  if (status === 'failed') return <CircleAlertIcon className="ml-auto size-3.5 text-destructive" />
  return <CheckIcon className="ml-auto size-3.5 text-emerald-500" />
}

function ValueBlock({ label, value }: { label: string; value: unknown }) {
  const text = formatValue(value)
  return (
    <div>
      <p className={cn(mono, 'mb-1 text-foreground/35')}>{label}</p>
      <pre className="m-0 max-h-32 overflow-auto whitespace-pre-wrap break-words text-foreground/65">
        {text}
      </pre>
    </div>
  )
}

function buildViewerItems(records: readonly AgentExecutionRecord[]): ViewerItem[] {
  const items: ViewerItem[] = []
  const tools = new Map<string, Extract<ViewerItem, { kind: 'tool' }>>()

  for (const record of records) {
    const event = record.event
    switch (event.type) {
      case 'user_message':
        items.push({ id: `user-${record.id}`, kind: 'user', timestamp: record.timestamp, text: event.text })
        break
      case 'thinking_delta':
        appendTextItem(items, 'thinking', event.text, record.id, record.timestamp)
        break
      case 'text_delta':
        appendTextItem(items, 'assistant', event.text, record.id, record.timestamp)
        break
      case 'tool_started': {
        const tool: Extract<ViewerItem, { kind: 'tool' }> = {
          id: `tool-${event.call.id}`,
          kind: 'tool',
          timestamp: record.timestamp,
          toolName: event.call.toolName,
          args: event.call.args,
          status: 'running',
        }
        tools.set(event.call.id, tool)
        items.push(tool)
        break
      }
      case 'tool_updated': {
        const tool = tools.get(event.toolCallId)
        if (tool) tool.output = event.partialResult
        break
      }
      case 'tool_finished': {
        const tool = tools.get(event.result.toolCallId)
        if (tool) {
          tool.output = event.result.output
          tool.status = event.result.success ? 'completed' : 'failed'
        }
        break
      }
      case 'approval_required': {
        const tool = tools.get(event.call.id)
        if (tool) tool.status = 'waiting'
        else {
          const approval: Extract<ViewerItem, { kind: 'tool' }> = {
            id: `approval-${event.approvalId}`,
            kind: 'tool',
            timestamp: record.timestamp,
            toolName: event.call.toolName,
            args: event.call.args,
            status: 'waiting',
          }
          tools.set(event.call.id, approval)
          items.push(approval)
        }
        break
      }
      case 'approval_resolved': {
        const tool = tools.get(event.toolCallId)
        if (tool) {
          tool.status = event.decision === 'allow' ? 'running' : 'failed'
          if (event.decision === 'deny') tool.output = '审批已拒绝'
        }
        break
      }
      case 'context_compaction_started':
        items.push({
          id: `compaction-${record.id}`,
          kind: 'status',
          timestamp: record.timestamp,
          text: '正在整理上下文',
          status: 'running',
        })
        break
      case 'context_compaction_completed':
        appendStatus(items, '上下文整理完成', record.id, record.timestamp, 'completed')
        break
      case 'context_compaction_failed':
        appendStatus(items, event.error, record.id, record.timestamp, 'failed')
        break
      case 'agent_failed':
        appendStatus(items, event.error, record.id, record.timestamp, 'failed')
        break
      case 'agent_aborted':
        appendStatus(items, '子 Agent 已中止', record.id, record.timestamp, 'failed')
        break
      case 'agent_completed':
        appendStatus(items, '子 Agent 已完成', record.id, record.timestamp, 'completed')
        break
      default:
        break
    }
  }

  return items
}

function appendTextItem(
  items: ViewerItem[],
  kind: 'thinking' | 'assistant',
  text: string,
  id: number,
  timestamp: number,
): void {
  const previous = items.at(-1)
  if (previous?.kind === kind) {
    previous.text += text
    return
  }
  items.push({ id: `${kind}-${id}`, kind, timestamp, text })
}

function appendStatus(
  items: ViewerItem[],
  text: string,
  id: number,
  timestamp: number,
  status: 'running' | 'completed' | 'failed',
): void {
  items.push({ id: `status-${id}`, kind: 'status', timestamp, text, status })
}

function findTask(records: readonly AgentExecutionRecord[]): string | undefined {
  const record = records.find((candidate) => candidate.event.type === 'user_message')
  if (!record || record.event.type !== 'user_message') return undefined
  return record.event.text
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
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
