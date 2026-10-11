import type { SnapshotEvent } from '@earendil-works/pi-durable'
import type { BotState } from './bot'

export const BOT_STATE_LABELS: Record<BotState, string> = {
  idle: '就绪',
  thinking: '思考中',
  working: '执行中',
  waiting: '等待审批',
  completed: '已完成',
  error: '执行失败',
}

export function botState(snapshot: SnapshotEvent, waiting: boolean, now = Date.now()): BotState {
  if (waiting) return 'waiting'
  if (snapshot.tools.some((tool) => tool.status !== 'done')) return 'working'
  if (snapshot.run || snapshot.generation || snapshot.compactions.length) return 'thinking'
  const assistant = snapshot.entries
    .flatMap((entry) => entry.model ?? [])
    .filter((message) => message.role === 'assistant')
    .at(-1)
  if (assistant?.role === 'assistant') {
    if (assistant.stopReason === 'error') return 'error'
    if (assistant.stopReason !== 'aborted' && now - assistant.timestamp < 2500) return 'completed'
  }
  return 'idle'
}
