import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import type { AgentRun } from '@/shared/agent/agentRun'
import type { AgentContextUsage } from '@/shared/agent/agentContextUsage'
import { formatContextTokens } from '@/shared/agent/contextTokens'

export interface CompactionTimelineDetail {
  reason: 'manual' | 'threshold' | 'overflow'
  tokensBefore?: number
  estimatedTokensAfter?: number
  actualTokensAfter?: number
  contextWindow?: number
  usageTimestamp?: number
  error?: string
}

export const COMPACTION_REASON_LABELS = {
  manual: '手动整理',
  threshold: '达到自动压缩阈值',
  overflow: '上下文溢出',
} as const

export type TimelineItemKind =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'plan'
  | 'approval'
  | 'compaction'
  | 'error'
export type TimelineItemStatus = 'running' | 'completed' | 'failed'

export interface TimelineItem {
  id: string
  kind: TimelineItemKind
  title: string
  summary?: string
  detail?: unknown
  timestamp: number
  durationMs: number
  status: TimelineItemStatus
}

export interface ExecutionTimelineModel {
  totalMs: number
  items: TimelineItem[]
  stepContextUsage: Record<string, AgentContextUsage>
}

export function buildExecutionTimeline(
  run: AgentRun,
  records: readonly AgentExecutionRecord[],
  now = Date.now(),
): ExecutionTimelineModel {
  const origin = run.startedAt ?? run.createdAt
  const end = run.completedAt ?? (isActive(run) ? now : run.updatedAt)
  const totalMs = Math.max(0, end - origin)
  const items: TimelineItem[] = []
  const tools = new Map<string, TimelineItem>()
  const approvals = new Map<string, TimelineItem>()
  const stepContextUsage: Record<string, AgentContextUsage> = {}
  let activeCompaction: TimelineItem | undefined
  let completedCompaction: TimelineItem | undefined
  let streamStepId: string | undefined

  for (const record of [...records].sort((a, b) => a.seq - b.seq)) {
    const event = record.event
    switch (event.type) {
      case 'system_prompt':
        items.push({
          ...item(record.id, 'system', 'System Prompt', record.timestamp),
          summary: event.text,
          detail: event.text,
        })
        break
      case 'user_message':
        items.push({
          ...item(record.id, 'user', '用户消息', record.timestamp),
          summary: event.text,
          detail: event.text,
        })
        break
      case 'agent_started':
        break
      case 'step_started':
        streamStepId = undefined
        break
      case 'context_usage_updated':
        if (event.source === 'step' && record.stepId) stepContextUsage[record.stepId] = event.usage
        if (event.source === 'compaction' && completedCompaction) {
          const detail = completedCompaction.detail as CompactionTimelineDetail
          detail.actualTokensAfter = event.usage.tokens
          detail.contextWindow ??= event.usage.contextWindow
          detail.usageTimestamp = record.timestamp
          completedCompaction = undefined
        }
        break
      case 'thinking_delta': {
        const previous = items.at(-1)
        if (previous?.title === 'Thinking' && streamStepId === record.stepId) {
          previous.summary = `${previous.summary ?? ''}${event.text}`
          previous.detail = previous.summary
          previous.durationMs = Math.max(0, record.timestamp - previous.timestamp)
        } else {
          items.push({
            ...item(record.id, 'assistant', 'Thinking', record.timestamp),
            summary: event.text,
            detail: event.text,
          })
        }
        streamStepId = record.stepId
        break
      }
      case 'text_delta': {
        const previous = items.at(-1)
        if (
          previous?.title === 'AI 消息' &&
          previous.status === 'completed' &&
          streamStepId === record.stepId
        ) {
          previous.summary = `${previous.summary ?? ''}${event.text}`
          previous.detail = previous.summary
          previous.durationMs = Math.max(0, record.timestamp - previous.timestamp)
        } else {
          items.push({
            ...item(record.id, 'assistant', 'AI 消息', record.timestamp),
            summary: event.text,
            detail: event.text,
          })
        }
        streamStepId = record.stepId
        break
      }
      case 'artifact_created':
        items.push({
          ...item(record.id, 'system', 'Artifact', record.timestamp),
          summary: event.artifact.title,
          detail: event.artifact,
        })
        break
      case 'tool_started': {
        const tool = {
          ...item(record.id, 'tool', event.call.toolName, record.timestamp),
          summary: timelineText(event.call.args),
          detail: { args: event.call.args },
          status: 'running' as const,
        }
        tools.set(event.call.id, tool)
        items.push(tool)
        break
      }
      case 'tool_updated': {
        const tool = tools.get(event.toolCallId)
        if (tool) {
          tool.durationMs = Math.max(0, record.timestamp - tool.timestamp)
          tool.detail = { ...asObject(tool.detail), partialResult: event.partialResult }
          const update = timelineText(event.partialResult)
          if (update) {
            tool.summary = [timelineText(asObject(tool.detail)?.args), update]
              .filter(Boolean)
              .join(' → ')
          }
        }
        break
      }
      case 'tool_finished': {
        const tool = tools.get(event.result.toolCallId)
        if (tool) {
          tool.durationMs = Math.max(0, record.timestamp - tool.timestamp)
          tool.status = event.result.status === 'success' ? 'completed' : 'failed'
          const result = timelineText(event.result)
          tool.summary = [timelineText(asObject(tool.detail)?.args), result]
            .filter(Boolean)
            .join(' → ')
          tool.detail = { ...asObject(tool.detail), result: event.result }
        }
        break
      }
      case 'plan_updated':
        items.push({
          ...item(record.id, 'plan', '更新计划', record.timestamp),
          summary: planSummary(event.plan),
          detail: event.plan,
        })
        break
      case 'context_compaction_started': {
        const compaction = {
          ...item(record.id, 'compaction', '正在整理上下文…', record.timestamp),
          summary: COMPACTION_REASON_LABELS[event.reason],
          detail: { reason: event.reason, tokensBefore: event.tokensBefore, contextWindow: event.contextWindow },
          status: 'running' as const,
        }
        activeCompaction = compaction
        completedCompaction = undefined
        items.push(compaction)
        break
      }
      case 'context_compaction_completed': {
        const compaction =
          activeCompaction ?? item(record.id, 'compaction', '已整理上下文', record.timestamp)
        if (!activeCompaction) items.push(compaction)
        compaction.title = '已整理上下文'
        compaction.durationMs = Math.max(0, record.timestamp - compaction.timestamp)
        compaction.detail = {
          ...asObject(compaction.detail),
          reason: event.reason,
          ...(event.tokensBefore !== undefined ? { tokensBefore: event.tokensBefore } : {}),
          ...(event.estimatedTokensAfter !== undefined
            ? { estimatedTokensAfter: event.estimatedTokensAfter }
            : {}),
          ...(event.contextWindow !== undefined ? { contextWindow: event.contextWindow } : {}),
        }
        const detail = compaction.detail as CompactionTimelineDetail
        compaction.summary = [compactionSummary(detail.tokensBefore, detail.estimatedTokensAfter), COMPACTION_REASON_LABELS[event.reason]].filter(Boolean).join('\n')
        compaction.status = 'completed'
        activeCompaction = undefined
        completedCompaction = compaction
        break
      }
      case 'context_compaction_failed': {
        const compaction =
          activeCompaction ??
          item(record.id, 'compaction', '上下文整理失败', record.timestamp)
        if (!activeCompaction) items.push(compaction)
        compaction.title = '上下文整理失败'
        compaction.durationMs = Math.max(0, record.timestamp - compaction.timestamp)
        compaction.detail = {
          ...asObject(compaction.detail),
          reason: event.reason,
          error: event.error,
          ...(event.tokensBefore !== undefined ? { tokensBefore: event.tokensBefore } : {}),
          ...(event.contextWindow !== undefined ? { contextWindow: event.contextWindow } : {}),
        }
        const detail = compaction.detail as CompactionTimelineDetail
        const usage = detail.tokensBefore === undefined ? undefined : `${formatContextTokens(detail.tokensBefore)}${detail.contextWindow === undefined ? '' : ` / ${formatContextTokens(detail.contextWindow)}`}`
        compaction.summary = [COMPACTION_REASON_LABELS[event.reason], usage, event.error].filter(Boolean).join('\n')
        compaction.status = 'failed'
        activeCompaction = undefined
        completedCompaction = undefined
        break
      }
      case 'approval_required': {
        const approval = {
          ...item(record.id, 'approval', `审批 · ${event.call.toolName}`, record.timestamp),
          summary: timelineText(event.call.args),
          detail: event.call.args,
          status: 'running' as const,
        }
        approvals.set(event.approvalId, approval)
        items.push(approval)
        break
      }
      case 'approval_resolved': {
        const approval = approvals.get(event.approvalId)
        if (approval) {
          approval.durationMs = Math.max(0, record.timestamp - approval.timestamp)
          approval.status = event.decision === 'allow' ? 'completed' : 'failed'
        }
        break
      }
      case 'agent_failed':
        items.push({
          ...item(record.id, 'error', '执行失败', record.timestamp),
          summary: event.error,
          status: 'failed',
        })
        break
      case 'agent_aborted':
        items.push({
          ...item(record.id, 'error', '执行已中止', record.timestamp),
          status: 'failed',
        })
        break
      case 'agent_completed':
        break
    }
  }

  if (activeCompaction) {
    activeCompaction.durationMs = Math.max(0, end - activeCompaction.timestamp)
  }

  const systemPromptIndex = items.findIndex((timelineItem) => timelineItem.kind === 'system')
  if (systemPromptIndex > 0) {
    items.unshift(items.splice(systemPromptIndex, 1)[0]!)
  }

  return { totalMs, items, stepContextUsage }
}

function item(id: number, kind: TimelineItemKind, title: string, timestamp: number): TimelineItem {
  return { id: String(id), kind, title, timestamp, durationMs: 0, status: 'completed' }
}

function isActive(run: AgentRun) {
  return run.status === 'created' || run.status === 'running' || run.status === 'waiting'
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function timelineText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(timelineText).filter(Boolean).join(' ')

  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (Array.isArray(object.content)) {
      const content = object.content.map(timelineText).filter(Boolean).join(' ')
      if (content) return content
    }
    if (typeof object.text === 'string') return object.text
  }

  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function planSummary(plan: { steps: readonly { status: string }[] }): string {
  const completed = plan.steps.filter((step) => step.status === 'completed').length
  return `${completed} / ${plan.steps.length}`
}

function compactionSummary(tokensBefore?: number, estimatedTokensAfter?: number): string {
  const before = tokensBefore === undefined ? undefined : formatContextTokens(tokensBefore)
  const after = estimatedTokensAfter === undefined ? undefined : formatContextTokens(estimatedTokensAfter)
  if (before && after) return `${before} → ~${after}`
  return before ?? (after ? `~${after}` : '')
}
