import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import type { AgentRun } from '@/shared/agent/agentRun'

export type TimelineItemKind =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'approval'
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

  for (const record of records) {
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
      case 'text_delta': {
        const previous = items.at(-1)
        if (previous?.kind === 'assistant' && previous.status === 'completed') {
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
        break
      }
      case 'tool_started': {
        const tool = {
          ...item(record.id, 'tool', event.tool, record.timestamp),
          summary: timelineText(event.args),
          detail: { args: event.args },
          status: 'running' as const,
        }
        tools.set(event.toolCallId, tool)
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
        const tool = tools.get(event.toolCallId)
        if (tool) {
          tool.durationMs = Math.max(0, record.timestamp - tool.timestamp)
          tool.status = event.success ? 'completed' : 'failed'
          const result = timelineText(event.result)
          tool.summary = [timelineText(asObject(tool.detail)?.args), result]
            .filter(Boolean)
            .join(' → ')
          tool.detail = { ...asObject(tool.detail), result: event.result }
        }
        break
      }
      case 'approval_required': {
        const approval = {
          ...item(record.id, 'approval', `审批 · ${event.tool}`, record.timestamp),
          summary: timelineText(event.args),
          detail: event.args,
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

  return { totalMs, items }
}

function item(
  id: number,
  kind: TimelineItemKind,
  title: string,
  timestamp: number,
): TimelineItem {
  return { id: String(id), kind, title, timestamp, durationMs: 0, status: 'completed' }
}

function isActive(run: AgentRun) {
  return run.status === 'created' || run.status === 'running' || run.status === 'waiting'
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
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
