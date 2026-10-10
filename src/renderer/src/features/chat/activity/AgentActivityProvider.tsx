import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { AgentEventEnvelope } from '@/shared/agent/agentExecutionRecord'
import type { AgentRun } from '@/shared/agent/agentRun'
import type { AgentActivity } from '@/shared/agent/agentActivity'
import { deriveAgentActivities } from '@/shared/agent/deriveAgentActivities'
import { groupAgentActivities, type ActivitySegment } from '@/shared/agent/groupAgentActivities'
import { usePreview } from '../../preview/PreviewProvider'
import { useChatStore } from '../runtime/chat-runtime'

export interface ActivityRun {
  run: AgentRun
  activities: readonly AgentActivity[]
  segments: readonly ActivitySegment[]
}

function createActivityStore() {
  let groups: readonly ActivityRun[] = []
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => groups,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish: (next: readonly ActivityRun[]) => {
      groups = next
      listeners.forEach((listener) => listener())
    },
  }
}

const AgentActivityContext = createContext(createActivityStore())

export function useActivitySelector<T>(selector: (groups: readonly ActivityRun[]) => T): T {
  const store = useContext(AgentActivityContext)
  return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}

export function AgentActivityProvider({
  sessionId,
  children,
}: {
  sessionId?: string
  children: ReactNode
}) {
  const [store] = useState(createActivityStore)
  const chat = useChatStore()
  const { refreshFile } = usePreview()
  const refreshPreviewFile = useEffectEvent(refreshFile)

  useEffect(() => {
    store.publish([])
    if (!sessionId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const completed = new Map<string, { signature: string; events: AgentEventEnvelope[] }>()
    const refreshed = new Set<string>()
    let initialized = false
    let loading = false
    let dirty = false
    const schedule = () => {
      dirty = true
      timer ??= setTimeout(() => {
        timer = undefined
        void load().catch(error => console.error('[AgentActivity] could not load activity', error))
      }, 100)
    }
    const load = async () => {
      if (disposed || loading || chat.getSnapshot().current.historical) return
      loading = true
      dirty = false
      try {
        const runs = await window.api.listAgentRuns({ sessionId })
        const groups = await Promise.all(runs.map(async run => {
          const signature = JSON.stringify(run)
          const cached = completed.get(run.id)
          const events = cached?.signature === signature ? cached.events : await window.api.listAgentExecutionRecords({ runId: run.id })
          if (['completed', 'aborted', 'failed'].includes(run.status)) completed.set(run.id, { signature, events })
          const activities = deriveAgentActivities(events, run)
          return { run, activities, segments: groupAgentActivities(events, activities) }
        }))
        if (disposed) return
        for (const group of groups) {
          for (const activity of group.activities) {
            if (!('call' in activity) || !('result' in activity) || activity.result?.status !== 'success' || !['edit', 'write'].includes(activity.call.toolName)) continue
            const key = `${group.run.id}:${activity.call.id}`
            if (refreshed.has(key)) continue
            refreshed.add(key)
            const args = activity.call.args as Record<string, unknown>
            const path = args.path ?? args.file_path
            if (initialized && typeof path === 'string') refreshPreviewFile(path)
          }
        }
        initialized = true
        store.publish(groups)
      } finally {
        loading = false
        if (!disposed && dirty) schedule()
      }
    }
    const unsubscribe = chat.subscribe(schedule)
    const poll = setInterval(() => { if (chat.getSnapshot().current.projected.isRunning) schedule() }, 500)
    void load().catch((error) =>
      console.error('[AgentActivity] could not load activity history', error),
    )
    return () => {
      disposed = true
      unsubscribe()
      clearInterval(poll)
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, store, chat])

  return <AgentActivityContext.Provider value={store}>{children}</AgentActivityContext.Provider>
}
