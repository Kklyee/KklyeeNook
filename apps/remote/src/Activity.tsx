import { createContext, useContext, useState } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { CheckIcon, Loader2Icon } from 'lucide-react'
import type { RemoteActivity, RemoteMessage } from '@kklyeenook/shared/remote/index'
import { ActivityIcon } from '@kklyeenook/ui/assistant-ui/tool-icon'
import { ToolTimeline } from '@kklyeenook/ui/assistant-ui/tool-timeline'
import { ShimmerLabel } from '@kklyeenook/ui/lib/surfaces'

export const ActivityContext = createContext<{ activities: RemoteActivity[]; messages: RemoteMessage[] }>({ activities: [], messages: [] })

export function InlineActivity({ afterPartIndex }: { afterPartIndex?: number }) {
  const { activities, messages } = useContext(ActivityContext)
  const id = useAuiState(state => state.message.id)
  const running = useAuiState(state => state.message.isLast && state.thread.isRunning)
  const partOffset = useAuiState(state => afterPartIndex === undefined ? 0 : state.message.content.slice(0, afterPartIndex + 1).reduce((offset, part) => offset + (part.type === 'text' ? part.text.length : 0), 0))
  const match = (message: RemoteMessage) => activities.find(activity => activity.toolCallId && message.content.some(part => part.type === 'data' && part.data.toolCallId === activity.toolCallId))?.runId
    ?? activities.find(activity => message.timestamp >= activity.runCreatedAt && message.timestamp <= (activity.runCompletedAt ?? Infinity))?.runId
  const index = messages.findIndex(message => message.id === id)
  const message = messages[index]
  const runId = message ? match(message) : running ? activities.at(-1)?.runId : undefined
  const previousText = messages.slice(0, index < 0 ? messages.length : index).filter(message => message.role === 'assistant' && match(message) === runId).reduce((offset, message) => offset + message.content.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 0), 0), 0)
  if (afterPartIndex !== undefined && message && !message.content.slice(afterPartIndex + 1).some(part => part.type === 'text') && messages.slice(index + 1).some(next => next.role === 'assistant' && match(next) === runId)) return null
  const entries = activities.filter(activity => activity.runId === runId && activity.textOffset === previousText + partOffset && (activity.type !== 'thinking' || activity.detail?.trim() || activity.status === 'running'))
  const waiting = running && afterPartIndex === undefined && !message?.content.some(part => part.type === 'text' && part.text.trim()) && !entries.length
  if (!entries.length && !waiting) return null
  return <Activity key={`${runId}:${previousText + partOffset}`} activities={entries} waiting={waiting} />
}

export function Activity({ activities, waiting = false }: { activities: RemoteActivity[]; waiting?: boolean }) {
  const [open, setOpen] = useState(false)
  const current = [...activities].reverse().find(activity => activity.status === 'running' || activity.status === 'waiting') ?? activities.at(-1)
  const running = waiting || activities.some(activity => activity.status === 'running' || activity.status === 'waiting')
  const failed = current?.status === 'failed'
  const label = running || failed ? current?.label ?? '思考中' : activities[0]?.summary ?? '本轮活动已完成'
  const duration = current?.endedAt && activities[0]?.startedAt ? `${Math.max(0, (current.endedAt - activities[0].startedAt) / 1000).toFixed(1)}s` : undefined
  return <section aria-label="Agent Activity" data-slot="agent-activity-slot" className="py-2">
    <ToolTimeline open={open} onOpenChange={setOpen} label={<span className="flex min-w-0 items-center gap-2">{running || failed ? current ? <ActivityIcon type={current.type} status={current.status} /> : <Loader2Icon className="size-3.5 shrink-0 animate-spin" /> : <CheckIcon className="size-3.5 shrink-0" />}<ShimmerLabel active={running} className="truncate">{label}</ShimmerLabel></span>} trailing={<span className="shrink-0 text-xs text-muted-foreground">{duration}</span>}>
      {activities.map(activity => <details key={activity.id} className="mobile-activity-row my-2 rounded-xl p-3">
        <summary className="flex min-h-6 cursor-pointer list-none items-center gap-2"><ActivityIcon type={activity.type} status={activity.status} /><span className="min-w-0 flex-1 truncate text-sm">{activity.label}</span>{activity.status === 'running' ? <Loader2Icon className="size-3.5 shrink-0 animate-spin" /> : activity.status === 'completed' ? <CheckIcon className="size-3.5 shrink-0 text-success" /> : null}</summary>
        {activity.detail && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{activity.detail}</pre>}
      </details>)}
    </ToolTimeline>
  </section>
}
