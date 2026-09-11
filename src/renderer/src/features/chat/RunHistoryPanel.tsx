import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  Clock3Icon,
  KeyRoundIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  UserIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react'

import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import type { AgentRun, AgentRunStatus } from '@/shared/agent/agentRun'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import {
  TraceWaterfall,
  type TraceLane,
  type TraceSegment,
  type TraceTone,
} from '@/renderer/src/components/assistant-ui/elements/trace-waterfall'
import { cn } from '@/renderer/src/lib/utils'
import { field, mono } from '@/renderer/src/lib/surfaces'
import {
  buildExecutionTimeline,
  type ExecutionTimelineModel,
  type TimelineItem,
  type TimelineItemKind,
} from './executionTimeline'

interface RunTimeline {
  run: AgentRun
  turn: number
  model: ExecutionTimelineModel
}

interface SelectedEvent {
  run: AgentRun
  event: TimelineItem
}

export function RunHistoryPanel({ sessionId }: { sessionId?: string }) {
  const [expandedRunIds, setExpandedRunIds] = useState<readonly string[]>([])
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent>()
  const runsQuery = useQuery({
    queryKey: ['agent-runs', sessionId],
    queryFn: () => window.api.listAgentRuns({ sessionId: sessionId! }),
    enabled: Boolean(sessionId),
    refetchInterval: 1_000,
  })
  const runs = runsQuery.data ?? []
  const recordQuery = useQuery({
    queryKey: ['agent-execution-records', sessionId, runs.map((run) => run.id).join(',')],
    queryFn: async () => {
      const groups = await Promise.all(
        runs.map(async (run) => [run.id, await loadExecutionRecords(run.id)] as const),
      )
      return new Map(groups)
    },
    enabled: runs.length > 0,
    refetchInterval: runs.some((run) => isActive(run.status)) ? 500 : false,
    retry: false,
  })

  useEffect(() => {
    setExpandedRunIds([])
    setSelectedEvent(undefined)
  }, [sessionId])

  useEffect(() => {
    const latest = runs[0]
    if (!latest) return
    setExpandedRunIds((current) => {
      if (current.includes(latest.id)) return current
      return isActive(latest.status) || current.length === 0 ? [latest.id, ...current] : current
    })
  }, [runs])

  const timelines = useMemo<RunTimeline[]>(() => {
    return [...runs]
      .reverse()
      .map((run, index) => ({
        run,
        turn: index + 1,
        model: buildExecutionTimeline(run, recordQuery.data?.get(run.id) ?? []),
      }))
  }, [recordQuery.data, runs])
  const overview = useMemo(() => buildOverview(timelines), [timelines])
  const selectedSegmentId = selectedEvent
    ? eventSegmentId(selectedEvent.run.id, selectedEvent.event.id)
    : undefined

  if (!sessionId) {
    return <EmptyState title="选择一个对话" description="该对话的执行轨迹会显示在这里。" />
  }

  if (runsQuery.isLoading) {
    return <EmptyState loading title="正在加载执行轨迹" description="" />
  }

  if (runsQuery.isError) {
    return <EmptyState title="执行轨迹加载失败" description={toErrorMessage(runsQuery.error)} />
  }

  if (!runs.length) {
    return (
      <EmptyState title="还没有 Run" description="发送一条消息后，可以在这里追踪完整执行过程。" />
    )
  }

  const toggleRun = (runId: string) => {
    setExpandedRunIds((current) =>
      current.includes(runId) ? current.filter((id) => id !== runId) : [...current, runId],
    )
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TraceWaterfall
          lanes={overview.lanes}
          totalMs={overview.totalMs}
          runCount={runs.length}
          toolCount={overview.toolCount}
          selectedSegmentId={selectedSegmentId}
          onSegmentSelect={(segmentId) => {
            const eventSelection = overview.events.get(segmentId)
            if (eventSelection) {
              setSelectedEvent(eventSelection)
              setExpandedRunIds((current) =>
                current.includes(eventSelection.run.id)
                  ? current
                  : [...current, eventSelection.run.id],
              )
              return
            }
            const runId = overview.runs.get(segmentId)
            if (runId) toggleRun(runId)
          }}
        />

        {recordQuery.isError && (
          <div className="border-destructive/25 bg-destructive/[0.06] text-destructive border-b px-3 py-2 text-xs">
            {executionRecordError(recordQuery.error)}
          </div>
        )}

        <div className="border-border/60 grid h-8 shrink-0 grid-cols-[4rem_minmax(0,1fr)_5rem] items-center border-b px-3 text-[10px] font-medium text-foreground/35">
          <span>来源</span>
          <span>事件</span>
          <span className="text-right">时间</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {timelines.map((timeline) => (
            <RunGroup
              key={timeline.run.id}
              timeline={timeline}
              open={expandedRunIds.includes(timeline.run.id)}
              selectedEventId={
                selectedEvent?.run.id === timeline.run.id ? selectedEvent.event.id : undefined
              }
              onToggle={() => toggleRun(timeline.run.id)}
              onSelect={(event) => setSelectedEvent({ run: timeline.run, event })}
            />
          ))}
        </div>
      </section>

      {selectedEvent && (
        <EventDetailPanel
          key={`${selectedEvent.run.id}-${selectedEvent.event.id}`}
          selected={selectedEvent}
          onClose={() => setSelectedEvent(undefined)}
        />
      )}
    </div>
  )
}

function RunGroup({
  timeline,
  open,
  selectedEventId,
  onToggle,
  onSelect,
}: {
  timeline: RunTimeline
  open: boolean
  selectedEventId?: string
  onToggle: () => void
  onSelect: (event: TimelineItem) => void
}) {
  const { run, turn, model } = timeline

  return (
    <div className="border-border/60 border-b">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="bg-foreground/[0.018] hover:bg-foreground/[0.04] grid h-8 w-full grid-cols-[4rem_minmax(0,1fr)_5rem] items-center px-3 text-left transition-colors"
      >
        <span className="flex items-center gap-1 text-[10px] text-foreground/40">
          <ChevronDownIcon className={cn('size-3 transition-transform', !open && '-rotate-90')} />第{' '}
          {turn} 轮
        </span>
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <StatusDot status={run.status} />
          <span className="truncate">Run {turn}</span>
          <StatusLabel status={run.status} />
          <span className={cn(mono, 'text-foreground/25 hidden truncate lg:inline')}>{run.id}</span>
        </span>
        <span className={cn(mono, 'text-foreground/35 text-right tabular-nums')}>
          {formatDuration(model.totalMs)}
        </span>
      </button>

      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-150">
          {model.items.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              run={run}
              selected={selectedEventId === event.id}
              onClick={() => onSelect(event)}
            />
          ))}
          {!model.items.length && (
            <p className="text-foreground/30 px-16 py-3 text-xs">
              该历史 Run 没有可回溯的事件明细。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function EventRow({
  event,
  run,
  selected,
  onClick,
}: {
  event: TimelineItem
  run: AgentRun
  selected: boolean
  onClick: () => void
}) {
  const meta = EVENT_META[event.kind]

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-border/35 grid min-h-9 w-full grid-cols-[4rem_minmax(0,1fr)_5rem] items-center border-t px-3 text-left transition-colors',
        selected ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.035]',
      )}
    >
      <span
        className={cn(
          'flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
          meta.className,
        )}
      >
        {/*<Icon className="size-2.5" />*/}
        {meta.label}
      </span>
      <span className="flex min-w-0 items-center gap-2 pr-3">
        <span className="shrink-0 text-xs font-medium">{event.title}</span>
        {event.summary && (
          <span className="min-w-0 truncate text-xs text-foreground/42">{event.summary}</span>
        )}
        {event.status === 'running' && (
          <LoaderCircleIcon className="size-3 shrink-0 animate-spin text-blue-500" />
        )}
        {event.kind === 'tool' && event.status === 'completed' && (
          <CheckIcon className="size-3 shrink-0 text-emerald-500" aria-label="执行成功" />
        )}
        {event.kind === 'tool' && event.status === 'failed' && (
          <CircleAlertIcon className="size-3 shrink-0 text-destructive" aria-label="执行失败" />
        )}
      </span>
      <span className={cn(mono, 'text-foreground/30 text-right tabular-nums')}>
        +{formatDuration(Math.max(0, event.timestamp - (run.startedAt ?? run.createdAt)))}
      </span>
    </button>
  )
}

function EventDetailPanel({ selected, onClose }: { selected: SelectedEvent; onClose: () => void }) {
  const { run, event } = selected
  const meta = EVENT_META[event.kind]
  const sections = eventDetailSections(event)
  const [activeTab, setActiveTab] = useState<'overview' | 'input' | 'output'>('overview')
  const tabs = [
    { id: 'overview' as const, label: '概览', visible: true },
    {
      id: 'input' as const,
      label: event.kind === 'tool' ? '参数' : '内容',
      visible: sections.input !== undefined,
    },
    { id: 'output' as const, label: '结果', visible: sections.output !== undefined },
  ].filter((tab) => tab.visible)

  return (
    <aside className="border-border/60 flex w-[clamp(20rem,36vw,27.5rem)] max-w-[46%] shrink-0 flex-col border-l bg-background max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20 max-md:max-w-[92%] max-md:shadow-2xl">
      <div className="border-border/60 flex h-10 items-center gap-2 border-b px-3">
        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', meta.className)}>
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{event.title}</span>
        <button
          type="button"
          aria-label="关闭详情"
          onClick={onClose}
          className="text-foreground/40 hover:bg-foreground/[0.06] hover:text-foreground flex size-6 items-center justify-center rounded-md"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="border-border/60 flex h-8 shrink-0 items-stretch gap-0.5 border-b px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'relative px-2.5 text-[11px] transition-colors',
              activeTab === tab.id
                ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground'
                : 'text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/70',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <div className="pb-4">
            <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-y-0 py-2 text-xs">
              <DetailRow label="来源" value={meta.label} />
              <DetailRow
                label="状态"
                value={
                  event.status === 'running'
                    ? '进行中'
                    : event.status === 'failed'
                      ? '失败'
                      : '已完成'
                }
                error={event.status === 'failed'}
              />
              <DetailRow label="开始时间" value={formatDateTime(event.timestamp, true)} />
              <DetailRow
                label="耗时"
                value={event.status === 'running' ? '进行中' : formatDuration(event.durationMs)}
              />
              <DetailRow label="Run" value={run.id} monoValue />
            </dl>
            {sections.input !== undefined && (
              <DetailPreview
                title={event.kind === 'tool' ? '参数' : '内容'}
                onOpen={() => setActiveTab('input')}
              >
                <StructuredValue value={sections.input} preview />
              </DetailPreview>
            )}
            {sections.output !== undefined && (
              <DetailPreview
                title="结果"
                onOpen={() => setActiveTab('output')}
                error={event.status === 'failed'}
              >
                <StructuredValue value={sections.output} preview />
              </DetailPreview>
            )}
          </div>
        )}
        {activeTab === 'input' && sections.input !== undefined && (
          <div className="p-3">
            <StructuredValue value={sections.input} />
          </div>
        )}
        {activeTab === 'output' && sections.output !== undefined && (
          <div className={cn('p-3', event.status === 'failed' && 'text-destructive')}>
            <StructuredValue value={sections.output} />
          </div>
        )}
      </div>
    </aside>
  )
}

function DetailRow({
  label,
  value,
  error,
  monoValue,
}: {
  label: string
  value: string
  error?: boolean
  monoValue?: boolean
}) {
  return (
    <div className="col-span-2 grid min-h-6 grid-cols-subgrid items-center px-3">
      <dt className="text-foreground/35">{label}</dt>
      <dd
        className={cn('min-w-0 truncate', error && 'text-destructive', monoValue && mono)}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function DetailPreview({
  title,
  onOpen,
  error,
  children,
}: {
  title: string
  onOpen: () => void
  error?: boolean
  children: ReactNode
}) {
  return (
    <section className="mt-2">
      <button
        type="button"
        onClick={onOpen}
        className="text-foreground/55 hover:text-foreground flex h-7 items-center gap-1 px-3 text-xs font-medium"
      >
        {title}
        <ChevronDownIcon className="size-3 -rotate-90 text-foreground/30" />
      </button>
      <div
        className={cn(
          'mx-3 max-h-48 overflow-hidden rounded-lg border border-border/50 p-2.5',
          field,
          error && 'text-destructive',
        )}
      >
        {children}
      </div>
    </section>
  )
}

function StructuredValue({
  value,
  preview = false,
  depth = 0,
}: {
  value: unknown
  preview?: boolean
  depth?: number
}) {
  if (value === null) return <span className="font-mono text-[11px] text-foreground/35">null</span>
  if (typeof value === 'string') {
    return (
      <pre
        className={cn(
          mono,
          'm-0 whitespace-pre-wrap break-words text-foreground/70',
          preview && 'line-clamp-6',
        )}
      >
        {value}
      </pre>
    )
  }
  if (typeof value !== 'object') {
    return <span className={cn(mono, 'text-violet-500')}>{String(value)}</span>
  }

  const entries = Object.entries(value)
  if (!entries.length)
    return (
      <span className={cn(mono, 'text-foreground/35')}>{Array.isArray(value) ? '[]' : '{}'}</span>
    )

  return (
    <div className={cn(mono, 'min-w-0 space-y-1 text-[11px]')}>
      {entries.slice(0, preview ? 12 : undefined).map(([key, child]) => {
        const nested = typeof child === 'object' && child !== null
        return (
          <div key={key} className="min-w-0">
            <div className="flex min-w-0 items-start gap-1.5 leading-4">
              <span className="shrink-0 text-blue-500">{key}</span>
              <span className="text-foreground/25">:</span>
              {!nested && <StructuredValue value={child} preview={preview} depth={depth + 1} />}
            </div>
            {nested && (
              <div className="ml-2.5 border-l border-border/60 pl-2">
                <StructuredValue value={child} preview={preview} depth={depth + 1} />
              </div>
            )}
          </div>
        )
      })}
      {preview && entries.length > 12 && <span className="text-foreground/30">…</span>}
    </div>
  )
}

function eventDetailSections(event: TimelineItem): { input?: unknown; output?: unknown } {
  const detail =
    typeof event.detail === 'object' && event.detail !== null
      ? (event.detail as Record<string, unknown>)
      : undefined
  if (event.kind === 'tool') {
    return {
      input: detail?.args,
      output:
        detail?.result === undefined
          ? detail?.partialResult
          : detail.partialResult === undefined
            ? detail.result
            : { result: detail.result, updates: detail.partialResult },
    }
  }
  if (event.kind === 'approval') return { input: event.detail }
  return { input: event.detail ?? event.summary }
}

const EVENT_META: Record<
  TimelineItemKind,
  { label: string; icon: typeof UserIcon; className: string }
> = {
  system: { label: '系统', icon: BotIcon, className: 'bg-foreground/[0.06] text-foreground/55' },
  user: { label: '用户', icon: UserIcon, className: 'bg-blue-500/12 text-blue-500' },
  assistant: {
    label: '模型',
    icon: MessageSquareTextIcon,
    className: 'bg-violet-500/12 text-violet-500',
  },
  tool: { label: '工具', icon: WrenchIcon, className: 'bg-amber-500/12 text-amber-500' },
  approval: { label: '审批', icon: KeyRoundIcon, className: 'bg-emerald-500/12 text-emerald-500' },
  error: { label: '错误', icon: CircleAlertIcon, className: 'bg-destructive/10 text-destructive' },
}

function buildOverview(timelines: readonly RunTimeline[]) {
  if (!timelines.length) {
    return {
      lanes: [] as TraceLane[],
      totalMs: 0,
      toolCount: 0,
      events: new Map<string, SelectedEvent>(),
      runs: new Map<string, string>(),
    }
  }

  const durationSum = timelines.reduce((sum, timeline) => sum + timeline.model.totalMs, 0)
  const runGap = Math.max(1, durationSum * 0.012)
  const lanes: Array<Omit<TraceLane, 'segments'> & { segments: TraceSegment[] }> = [
    { id: 'runs', label: '轮次', segments: [] },
    { id: 'user', label: '输入', segments: [] },
    { id: 'assistant', label: '模型', segments: [] },
    { id: 'tool', label: '工具', segments: [] },
  ]
  const laneMap = new Map(lanes.map((lane) => [lane.id, lane]))
  let toolCount = 0
  let runOffset = 0
  const events = new Map<string, SelectedEvent>()
  const runSegments = new Map<string, string>()

  for (const { run, turn, model } of timelines) {
    const runStart = run.startedAt ?? run.createdAt
    laneMap
      .get('runs')!
      .segments.push({
        id: run.id,
        label: `Run ${turn}`,
        startMs: runOffset,
        durationMs: model.totalMs,
        tone:
          run.status === 'failed' || run.status === 'aborted' || run.status === 'interrupted'
            ? 'failed'
            : 'run',
      })
    runSegments.set(run.id, run.id)

    for (const event of model.items) {
      const laneId =
        event.kind === 'system' || event.kind === 'user'
          ? 'user'
          : event.kind === 'assistant'
            ? 'assistant'
            : event.kind === 'tool' || event.kind === 'approval'
              ? 'tool'
              : undefined
      if (!laneId) continue
      if (event.kind === 'tool') toolCount += 1
      const segmentId = eventSegmentId(run.id, event.id)
      laneMap
        .get(laneId)!
        .segments.push({
          id: segmentId,
          label: event.title,
          startMs: runOffset + Math.max(0, event.timestamp - runStart),
          durationMs: event.durationMs,
          tone: event.status === 'failed' ? 'failed' : (event.kind as TraceTone),
        })
      events.set(segmentId, { run, event })
    }

    runOffset += Math.max(1, model.totalMs) + runGap
  }

  return { lanes, totalMs: Math.max(0, runOffset - runGap), toolCount, events, runs: runSegments }
}

function eventSegmentId(runId: string, eventId: string) {
  return `${runId}:${eventId}`
}

async function loadExecutionRecords(runId: string): Promise<AgentExecutionRecord[]> {
  const method = window.api.listAgentExecutionRecords
  if (typeof method === 'function') return method({ runId })

  return window.electron.ipcRenderer.invoke(IPC_CHANNELS.AGENT_EXECUTION_RECORD_LIST, { runId })
}

function EmptyState({
  title,
  description,
  loading,
}: {
  title: string
  description: string
  loading?: boolean
}) {
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      {loading ? (
        <LoaderCircleIcon className="size-5 animate-spin" />
      ) : (
        <Clock3Icon className="size-5" />
      )}
      <p className="text-foreground/70 text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs">{description}</p>}
    </div>
  )
}

function StatusDot({ status }: { status: AgentRunStatus }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        isActive(status) && 'animate-pulse bg-blue-500',
        status === 'completed' && 'bg-emerald-500',
        (status === 'failed' || status === 'aborted' || status === 'interrupted') &&
          'bg-destructive',
      )}
    />
  )
}

function StatusLabel({ status }: { status: AgentRunStatus }) {
  return <span className="text-[10px] font-normal text-foreground/35">{STATUS_LABEL[status]}</span>
}

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  created: '已创建',
  running: '执行中',
  waiting: '等待审批',
  completed: '已完成',
  failed: '失败',
  aborted: '已中止',
  interrupted: '被中断',
}

function isActive(status: AgentRunStatus) {
  return status === 'created' || status === 'running' || status === 'waiting'
}

function formatDateTime(value: number, includeMilliseconds = false) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(includeMilliseconds ? { fractionalSecondDigits: 3 as const } : {}),
  }).format(value)
}

function formatDuration(value: number) {
  if (value < 1_000) return `${Math.max(0, value)}ms`
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`
}

function executionRecordError(error: unknown) {
  const message = toErrorMessage(error)
  if (message.includes('No handler registered') || message.includes('is not a function')) {
    return '执行记录服务尚未加载。请完全退出并重新启动 Electron 应用（仅刷新页面不会更新 preload/main 进程）。'
  }
  return `执行记录加载失败：${message}`
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
