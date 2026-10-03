import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  SearchIcon,
  UserIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react'

import type { AgentExecutionRecord, AgentRunTrace } from '@/shared/agent/agentExecutionRecord'
import { ExecutionTraceProjector } from '@/shared/agent/executionTraceProjector'
import { StepTrace } from '../chat/trace/StepTrace'
import type { AgentRun, AgentRunStatus } from '@/shared/agent/agentRun'
import type { ToolExecutionResult } from '@/shared/tool/tool'
import { ToolResultRetention } from '@/renderer/src/components/assistant-ui/elements/tool-result-retention'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import {
  TraceWaterfall,
  type TraceLane,
  type TraceSegment,
  type TraceTone,
} from '@/renderer/src/components/assistant-ui/elements/trace-waterfall'
import { Input } from '@/renderer/src/components/ui/input'
import { cn } from '@/renderer/src/lib/utils'
import { field, mono } from '@/renderer/src/lib/surfaces'
import {
  buildExecutionTimeline,
  type ExecutionTimelineModel,
  type TimelineItem,
  type TimelineItemKind,
  type CompactionTimelineDetail,
  COMPACTION_REASON_LABELS,
} from './executionTimeline'

interface RunTimeline {
  run: AgentRun
  ordinal: number
  model: ExecutionTimelineModel
  trace: AgentRunTrace
  records: readonly AgentExecutionRecord[]
}

interface RunTreeNode {
  timeline: RunTimeline
  children: RunTreeNode[]
}

interface SelectedEvent {
  run: AgentRun
  event: TimelineItem
}

const emptyRuns: AgentRun[] = []

export function RunHistoryPanel(props: { sessionId?: string; focusedRunId?: string }) {
  return <RunHistoryContent key={props.sessionId ?? 'none'} {...props} />
}

function RunHistoryContent({
  sessionId,
  focusedRunId,
}: {
  sessionId?: string
  focusedRunId?: string
}) {
  const [collapsedRunIds, setCollapsedRunIds] = useState<readonly string[]>([])
  const collapsedRunIdSet = useMemo(() => new Set(collapsedRunIds), [collapsedRunIds])
  const [toolsExpanded, setToolsExpanded] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent>()
  const revealedRunId = useRef<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const query = search.trim().toLocaleLowerCase()
  const runsQuery = useQuery({
    queryKey: ['agent-runs', sessionId],
    queryFn: () => window.api.listAgentRuns({ sessionId: sessionId! }),
    enabled: Boolean(sessionId),
    refetchInterval: 1_000,
  })
  const runs = runsQuery.data ?? emptyRuns
  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
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
    if (!focusedRunId || !runs.length || revealedRunId.current === focusedRunId) return
    const ids: string[] = []
    let current = runById.get(focusedRunId)
    while (current) {
      ids.push(current.id)
      current = current.parentRunId ? runById.get(current.parentRunId) : undefined
    }
    if (!ids.length) return
    revealedRunId.current = focusedRunId
    const revealedRunIds = new Set(ids)
    setCollapsedRunIds((existing) => existing.filter((id) => !revealedRunIds.has(id)))
  }, [focusedRunId, runs, runById])

  const timelines = useMemo<RunTimeline[]>(() => {
    let ordinal = 0
    return [...runs]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((run) => ({
        run,
        ordinal: run.parentRunId ? 0 : ++ordinal,
        model: buildExecutionTimeline(run, recordQuery.data?.get(run.id) ?? []),
        trace: new ExecutionTraceProjector().project(run, recordQuery.data?.get(run.id) ?? []),
        records: recordQuery.data?.get(run.id) ?? [],
      }))
  }, [recordQuery.data, runs])
  const runTree = useMemo(() => buildRunTree(timelines, query), [timelines, query])
  const overview = useMemo(() => buildOverview(timelines), [timelines])
  const selectedSegmentId = selectedEvent
    ? eventSegmentId(selectedEvent.run.id, selectedEvent.event.id)
    : undefined
  const turnsExpanded = runTree.some((node) => !collapsedRunIdSet.has(node.timeline.run.id))

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
    setCollapsedRunIds((current) =>
      current.includes(runId) ? current.filter((id) => id !== runId) : [...current, runId],
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-neutral-100 dark:bg-[#222222]">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TraceWaterfall
          lanes={overview.lanes}
          totalMs={overview.totalMs}
          turnCount={runs.filter((run) => !run.parentRunId).length}
          toolCount={overview.toolCount}
          turnsExpanded={turnsExpanded}
          toolsExpanded={toolsExpanded}
          onToggleTurns={() => setCollapsedRunIds(turnsExpanded ? runs.map((run) => run.id) : [])}
          onToggleTools={() => setToolsExpanded((expanded) => !expanded)}
          toolbar={
            <div className="relative w-[150px] max-w-[35vw]">
              <SearchIcon className="pointer-events-none absolute left-1.5 top-1/2 size-2.5 -translate-y-1/2 text-foreground/35" />
              <Input
                type="search"
                aria-label="搜索执行轨迹"
                placeholder="搜索"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  if (event.target.value.trim()) {
                    setCollapsedRunIds([])
                    setToolsExpanded(true)
                  }
                }}
                className="h-[20px] rounded-md py-0 pl-5 pr-1.5 text-[10px] md:text-[10px]"
              />
            </div>
          }
          selectedSegmentId={selectedSegmentId}
          onSegmentSelect={(segmentId) => {
            const eventSelection = overview.events.get(segmentId)
            if (eventSelection) {
              setSelectedEvent(eventSelection)
              const runIds = [eventSelection.run.id]
              let parentId = eventSelection.run.parentRunId
              while (parentId) {
                runIds.push(parentId)
                parentId = runById.get(parentId)?.parentRunId
              }
              setCollapsedRunIds((current) => current.filter((id) => !runIds.includes(id)))
              if (
                eventSelection.event.kind === 'tool' ||
                eventSelection.event.kind === 'approval'
              ) {
                setToolsExpanded(true)
              }
              return
            }
          }}
        />

        {recordQuery.isError && (
          <div className="border-destructive/25 bg-destructive/[0.06] text-destructive border-b px-3 py-2 text-xs">
            {executionRecordError(recordQuery.error)}
          </div>
        )}

        <div id="execution-trace-runs" className="min-h-0 flex-1 overflow-y-auto">
          {runTree.map((node) => (
            <RunGroup
              key={node.timeline.run.id}
              node={node}
              depth={0}
              open={!collapsedRunIdSet.has(node.timeline.run.id)}
              query={query}
              selectedEvent={selectedEvent}
              onToggleRun={toggleRun}
              onSelect={(run, event) => setSelectedEvent({ run, event })}
              collapsedRunIds={collapsedRunIdSet}
              toolsExpanded={toolsExpanded}
              onExpandTools={() => setToolsExpanded(true)}
            />
          ))}
          {query && !runTree.length && (
            <p className="px-3 py-6 text-center text-xs text-foreground/40">没有匹配的执行事件</p>
          )}
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
  node,
  depth,
  open,
  selectedEvent,
  query,
  collapsedRunIds,
  toolsExpanded,
  onExpandTools,
  onToggleRun,
  onSelect,
}: {
  node: RunTreeNode
  depth: number
  open: boolean
  selectedEvent?: SelectedEvent
  query: string
  collapsedRunIds: ReadonlySet<string>
  toolsExpanded: boolean
  onExpandTools: () => void
  onToggleRun: (runId: string) => void
  onSelect: (run: AgentRun, event: TimelineItem) => void
}) {
  const { timeline, children } = node
  const { run, ordinal, model } = timeline
  const childTask = run.parentRunId
    ? model.items.find((event) => event.kind === 'user')?.summary
    : undefined
  const unscopedItems = buildExecutionTimeline(run, timeline.trace.unscopedEvents).items.filter(
    (event) => matchesSearch(event, query),
  )
  const recordById = new Map(timeline.records.map((record) => [String(record.id), record]))
  const claimedInputs = new Set(timeline.trace.steps.flatMap((step) => step.acceptedInputIds))
  const toolCount = model.items.filter((event) => event.kind === 'tool').length
  const entries = [
    ...timeline.trace.steps.map((step) => ({ seq: step.startedSeq, step, event: undefined })),
    ...unscopedItems
      .filter((event) => event.title !== 'System Prompt')
      .flatMap((event) => {
        const record = recordById.get(event.id)
        return record ? [{ seq: record.seq, step: undefined, event }] : []
      }),
  ].sort((a, b) => a.seq - b.seq)
  const renderEvent = (event: TimelineItem) => {
    const input = event.kind === 'user' ? recordById.get(event.id)?.event : undefined
    const inputLabel =
      input?.type === 'user_message' && input.inputId
        ? !claimedInputs.has(input.inputId)
          ? '未处理'
          : input.delivery === 'initial'
            ? undefined
            : '追加'
        : undefined
    return (
      <EventRow
        key={event.id}
        event={event}
        run={run}
        selected={selectedEvent?.run.id === run.id && selectedEvent.event.id === event.id}
        onClick={() => onSelect(run, event)}
        inputLabel={inputLabel}
      />
    )
  }
  const renderItems = (items: readonly TimelineItem[]) => {
    const calls = items.filter((event) => event.kind === 'tool' || event.kind === 'approval')
    const toolCalls = calls.filter((event) => event.kind === 'tool').length
    const approvals = calls.length - toolCalls
    return items.map((event) => {
      if (toolsExpanded || (event.kind !== 'tool' && event.kind !== 'approval'))
        return renderEvent(event)
      if (event !== calls[0]) return null
      return (
        <button
          key={`calls-${event.id}`}
          type="button"
          aria-label="展开所有调用"
          aria-expanded={false}
          onClick={onExpandTools}
          className="flex h-[24px] w-full items-center gap-[8px] border-b border-foreground/[0.035] pl-[36px] pr-[4px] text-left text-[11px] text-foreground/45 transition-colors hover:bg-foreground/[0.035] hover:text-foreground/75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400/60"
        >
          <span aria-hidden>…</span>
          <span>
            {[toolCalls ? `${toolCalls} 个工具调用` : '', approvals ? `${approvals} 项审批` : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
          {calls.some((call) => call.status === 'failed') && (
            <CircleAlertIcon className="size-3 text-destructive" aria-label="包含失败调用" />
          )}
          {calls.some((call) => call.status === 'running') && (
            <LoaderCircleIcon
              className="size-3 animate-spin text-blue-500"
              aria-label="调用进行中"
            />
          )}
        </button>
      )
    })
  }

  return (
    <div className="border-b border-border/50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggleRun(run.id)}
        className="flex h-5 w-full items-center gap-1.5 border-b border-foreground/[0.055] bg-foreground/[0.025] px-2 text-left text-[10px] transition-colors hover:bg-foreground/[0.04]"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        title={run.id}
      >
        <span className="flex items-center gap-1 text-[10px] text-foreground/40">
          <ChevronDownIcon className={cn('size-2.5 transition-transform', !open && '-rotate-90')} />
          {run.parentRunId ? 'Subagent' : `第 ${ordinal} 轮`}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium">
          <StatusDot status={run.status} />
          {run.parentRunId && (
            <span className="truncate">
              {run.displayName ?? 'Subagent'}
              {childTask ? ` · ${childTask}` : ''}
            </span>
          )}
          <StatusLabel status={run.status} />
        </span>
        <span className={cn(mono, 'ml-auto text-[10px] text-foreground/35 tabular-nums')}>
          {formatDuration(model.totalMs)}
        </span>
      </button>

      <div className="bg-foreground/[0.04] pl-[36px]">
        {unscopedItems.filter((event) => event.title === 'System Prompt').map(renderEvent)}
      </div>
      {open ? (
        <div>
          {entries.map(({ step, event }, index) => {
            if (event) {
              if (entries[index - 1]?.event) return null
              const nextStep = entries.findIndex(
                (entry, nextIndex) => nextIndex > index && entry.step,
              )
              const events = entries
                .slice(index, nextStep === -1 ? undefined : nextStep)
                .map((entry) => entry.event!)
              return (
                <div key={`unscoped-${event.id}`} className="pl-[36px]">
                  {renderItems(events)}
                </div>
              )
            }
            if (!step) return null
            const inputRecords = timeline.records.filter(
              (record) =>
                record.event.type === 'user_message' &&
                step.acceptedInputIds.includes(record.event.inputId),
            )
            const inputItems = buildExecutionTimeline(run, inputRecords).items.filter((event) =>
              matchesSearch(event, query),
            )
            const items = buildExecutionTimeline(run, step.events).items.filter((event) =>
              matchesSearch(event, query),
            )
            if (query && !inputItems.length && !items.length) return null
            return (
              <StepTrace
                key={step.id}
                step={step}
                run={run}
                empty={!items.length}
                inputs={inputItems.map(renderEvent)}
                contextUsage={model.stepContextUsage[step.id]}
              >
                {renderItems(items)}
              </StepTrace>
            )
          })}
          {!timeline.trace.steps.length && timeline.records.length > 0 && (
            <p className="border-t border-border/35 px-2 py-1 text-[10px] text-foreground/40">
              {timeline.records.some(
                (record) => record.event.type === 'user_message' && record.event.inputId,
              )
                ? '未处理输入'
                : 'Legacy Execution'}
            </p>
          )}
          {!model.items.length && (
            <p className="text-foreground/30 px-16 py-3 text-xs">
              该历史 Run 没有可回溯的事件明细。
            </p>
          )}
        </div>
      ) : (
        <div className="pl-[36px]">
          {model.items
            .filter((event) => event.kind === 'user' && matchesSearch(event, query))
            .map(renderEvent)}
          <button
            type="button"
            aria-label={
              run.parentRunId
                ? `展开子 Agent ${run.displayName ?? ''} 的执行明细`
                : `展开第 ${ordinal} 轮的执行明细`
            }
            aria-expanded={false}
            onClick={() => onToggleRun(run.id)}
            className="flex h-[24px] w-full items-center gap-[8px] pl-[36px] pr-[4px] text-left text-[11px] text-foreground/45 transition-colors hover:bg-foreground/[0.035] hover:text-foreground/75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400/60"
          >
            <span aria-hidden>…</span>
            <span>
              {timeline.trace.steps.length} 个步骤 · {toolCount} 个工具调用
            </span>
          </button>
          {unscopedItems.filter((event) => event.kind === 'error').map(renderEvent)}
        </div>
      )}
      {open &&
        children.map((child) => (
          <RunGroup
            key={child.timeline.run.id}
            node={child}
            depth={depth + 1}
            open={!collapsedRunIds.has(child.timeline.run.id)}
            query={query}
            selectedEvent={selectedEvent}
            collapsedRunIds={collapsedRunIds}
            toolsExpanded={toolsExpanded}
            onExpandTools={onExpandTools}
            onToggleRun={onToggleRun}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

function buildRunTree(timelines: readonly RunTimeline[], query: string): RunTreeNode[] {
  const nodes = new Map<string, RunTreeNode>()
  for (const timeline of timelines) nodes.set(timeline.run.id, { timeline, children: [] })
  const roots: RunTreeNode[] = []

  for (const node of nodes.values()) {
    const parentId = node.timeline.run.parentRunId
    const parent = parentId ? nodes.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  if (!query) return roots
  const filterNode = (node: RunTreeNode): RunTreeNode[] => {
    const children = node.children.flatMap(filterNode)
    return children.length || node.timeline.model.items.some((event) => matchesSearch(event, query))
      ? [{ ...node, children }]
      : []
  }
  return roots.flatMap(filterNode)
}

function matchesSearch(event: TimelineItem, query: string) {
  return `${EVENT_META[event.kind].label} ${event.title} ${event.summary ?? ''}`
    .toLocaleLowerCase()
    .includes(query)
}

function EventRow({
  event,
  run,
  selected,
  onClick,
  inputLabel,
}: {
  event: TimelineItem
  run: AgentRun
  selected: boolean
  onClick: () => void
  inputLabel?: string
}) {
  const meta = EVENT_META[event.kind]

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group grid h-[24px] w-full grid-cols-[24px_minmax(0,1fr)_56px] items-center gap-x-[8px] border-b border-foreground/[0.035] px-[4px] text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400/60',
        selected ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.035]',
        event.kind === 'compaction' && 'h-auto min-h-[40px] py-1',
      )}
    >
      <span
        className={cn(
          'inline-flex h-[16px] w-[24px] shrink-0 items-center justify-center whitespace-nowrap rounded-[2px] text-[10px] leading-[16px]',
          meta.className,
        )}
      >
        {meta.label}
      </span>
      <span
        className={cn(
          'flex min-w-0 items-center gap-[8px] pr-[4px] text-[11px] leading-[16px]',
          event.kind === 'compaction' && 'flex-col items-start gap-0',
        )}
      >
        <EventSummary event={event} inputLabel={inputLabel} />
      </span>
      <span
        className={cn(
          mono,
          'whitespace-nowrap text-right text-[10px] text-foreground/35 opacity-0 tabular-nums transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
          selected && 'opacity-100',
        )}
      >
        +{formatDuration(Math.max(0, event.timestamp - (run.startedAt ?? run.createdAt)))}
      </span>
    </button>
  )
}

function eventPreview(event: TimelineItem): string | undefined {
  if (event.kind !== 'tool' && event.kind !== 'approval') return event.summary
  const detail = event.detail as Record<string, unknown> | undefined
  const args = (event.kind === 'tool' ? detail?.args : detail) as Record<string, unknown> | undefined
  const values = ['command', 'path', 'file_path', 'query', 'pattern', 'url']
    .map((key) => args?.[key])
    .filter((value): value is string => typeof value === 'string')
  return values.length ? values.join(' · ') : event.summary
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
    <aside className="material-panel flex w-[clamp(20rem,36vw,27.5rem)] max-w-[46%] shrink-0 flex-col border-l max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20 max-md:max-w-[92%]">
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
        {event.kind === 'tool' && (
          <ToolResultRetention
            key={event.id}
            result={(event.detail as { result?: ToolExecutionResult })?.result}
          />
        )}
        {activeTab === 'overview' && (
          <EventOverview run={run} event={event} onOpen={setActiveTab} />
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
  system: { label: '系统', icon: BotIcon, className: 'bg-foreground/10 text-foreground/70' },
  user: {
    label: '用户',
    icon: UserIcon,
    className: 'bg-blue-500/20 text-blue-600 dark:text-blue-300',
  },
  assistant: {
    label: '助手',
    icon: MessageSquareTextIcon,
    className: 'bg-violet-500/20 text-violet-600 dark:text-violet-300',
  },
  compaction: {
    label: '压缩',
    icon: BotIcon,
    className: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300',
  },
  tool: {
    label: '工具',
    icon: WrenchIcon,
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  },
  plan: { label: '计划', icon: BotIcon, className: 'bg-cyan-500/12 text-cyan-500' },
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
    }
  }

  const durationSum = timelines.reduce((sum, timeline) => sum + timeline.model.totalMs, 0)
  const runGap = Math.max(1, durationSum * 0.012)
  const lanes: Array<Omit<TraceLane, 'segments'> & { segments: TraceSegment[] }> = [
    { id: 'user', label: '输入', segments: [] },
    { id: 'assistant', label: '模型', segments: [] },
    { id: 'tool', label: '工具', segments: [] },
  ]
  const laneMap = new Map(lanes.map((lane) => [lane.id, lane]))
  let toolCount = 0
  let runOffset = 0
  const events = new Map<string, SelectedEvent>()

  for (const { run, model } of timelines) {
    const runStart = run.startedAt ?? run.createdAt

    for (const event of model.items) {
      const laneId =
        event.kind === 'system' || event.kind === 'user'
          ? 'user'
          : event.kind === 'assistant'
            ? 'assistant'
            : event.kind === 'compaction'
              ? 'assistant'
              : event.kind === 'tool' || event.kind === 'plan' || event.kind === 'approval'
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
          tone:
            event.status === 'failed'
              ? 'failed'
              : event.kind === 'compaction'
                ? 'system'
                : event.kind === 'plan'
                  ? 'tool'
                  : (event.kind as TraceTone),
        })
      events.set(segmentId, { run, event })
    }

    runOffset += Math.max(1, model.totalMs) + runGap
  }

  return { lanes, totalMs: Math.max(0, runOffset - runGap), toolCount, events }
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

function EventSummary({ event, inputLabel }: { event: TimelineItem; inputLabel?: string }) {
  const summary = eventPreview(event)
  return (
    <>
      {event.title === '用户消息' || event.title === 'AI 消息' ? (
        <>
          {inputLabel && (
            <span className="shrink-0 text-[10px] text-blue-500 dark:text-blue-300">
              {inputLabel}
            </span>
          )}
          <span className="min-w-0 truncate text-foreground/90">{summary}</span>
        </>
      ) : (
        <>
          <span className="shrink-0 whitespace-nowrap text-foreground/85">
            {event.title === 'System Prompt' ? '初始系统提示词' : event.title}
          </span>
          {summary && event.title !== 'System Prompt' && (
            <span
              className={cn(
                'min-w-0 truncate text-foreground/60',
                event.kind === 'compaction' && 'whitespace-pre-line',
                event.kind === 'compaction' && event.status === 'failed' && 'text-destructive',
              )}
            >
              {summary}
            </span>
          )}
        </>
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
    </>
  )
}

function EventOverview({
  run,
  event,
  onOpen,
}: {
  run: AgentRun
  event: TimelineItem
  onOpen: (tab: 'input' | 'output') => void
}) {
  const meta = EVENT_META[event.kind]
  const sections = eventDetailSections(event)
  return (
    <div className="pb-4">
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-y-0 py-2 text-xs">
        <DetailRow label="来源" value={meta.label} />
        <DetailRow
          label="状态"
          value={
            event.status === 'running' ? '进行中' : event.status === 'failed' ? '失败' : '已完成'
          }
          error={event.status === 'failed'}
        />
        <DetailRow label="开始时间" value={formatDateTime(event.timestamp, true)} />
        <DetailRow
          label="耗时"
          value={event.status === 'running' ? '进行中' : formatDuration(event.durationMs)}
        />
        <DetailRow label="Run" value={run.id} monoValue />
        {run.parentRunId && <DetailRow label="Parent Run" value={run.parentRunId} monoValue />}
        <CompactionMetadata event={event} />
      </dl>
      {sections.input !== undefined && (
        <DetailPreview
          title={event.kind === 'tool' ? '参数' : '内容'}
          onOpen={() => onOpen('input')}
        >
          <StructuredValue value={sections.input} preview />
        </DetailPreview>
      )}
      {sections.output !== undefined && (
        <DetailPreview
          title="结果"
          onOpen={() => onOpen('output')}
          error={event.status === 'failed'}
        >
          <StructuredValue value={sections.output} preview />
        </DetailPreview>
      )}
    </div>
  )
}

function CompactionMetadata({ event }: { event: TimelineItem }) {
  if (event.kind !== 'compaction') return null
  const compaction = event.detail as CompactionTimelineDetail
  return (
    <>
      {compaction && (
        <DetailRow
          label="原因"
          value={`${COMPACTION_REASON_LABELS[compaction.reason]} (${compaction.reason})`}
        />
      )}
      {compaction?.tokensBefore !== undefined && (
        <DetailRow
          label="压缩前"
          value={compaction.tokensBefore.toLocaleString('en-US')}
          monoValue
        />
      )}
      {compaction?.estimatedTokensAfter !== undefined && (
        <DetailRow
          label="预计压缩后"
          value={`~${compaction.estimatedTokensAfter.toLocaleString('en-US')}`}
          monoValue
        />
      )}
      {compaction?.actualTokensAfter !== undefined && (
        <DetailRow
          label="压缩后实际"
          value={compaction.actualTokensAfter.toLocaleString('en-US')}
          monoValue
        />
      )}
      {compaction?.contextWindow !== undefined && (
        <DetailRow
          label="上下文窗口"
          value={compaction.contextWindow.toLocaleString('en-US')}
          monoValue
        />
      )}
      {compaction?.error && <DetailRow label="错误" value={compaction.error} error />}
    </>
  )
}
