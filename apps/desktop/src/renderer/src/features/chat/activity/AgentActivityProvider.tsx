import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { AgentRun } from '@kklyeenook/shared/agent/agentRun'
import type { AgentActivity } from '@kklyeenook/shared/agent/agentActivity'
import { deriveAgentActivities } from '@kklyeenook/shared/agent/deriveAgentActivities'
import { groupAgentActivities, type ActivitySegment } from '@kklyeenook/shared/agent/groupAgentActivities'
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
      if (groups.length === next.length && groups.every((group, index) => group === next[index])) return
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
    const completed = new Map<string, { signature: string; group: ActivityRun }>()
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
      if (disposed || loading || chat.getSnapshot().current.loading || chat.getSnapshot().selectedThreadId !== sessionId) return
      loading = true
      dirty = false
      try {
        const runs = await window.api.listAgentRuns({ sessionId, sinceEntry: chat.getSnapshot().extras.history.sinceEntry, details: false })
        const groups = await Promise.all(runs.map(async run => {
          const signature = JSON.stringify(run)
          const previousGroup = store.getSnapshot().find((group) => group.run.id === run.id)
          if (previousGroup && ['completed', 'aborted', 'failed', 'interrupted'].includes(run.status) && JSON.stringify(previousGroup.run) === signature) return previousGroup
          const cached = completed.get(run.id)
          if (cached?.signature === signature) {
            completed.delete(run.id)
            completed.set(run.id, cached)
            return cached.group
          }
          const events = await window.api.listAgentExecutionRecords({ runId: run.id })
          const activities = deriveAgentActivities(events, run)
          const group = { run, activities, segments: groupAgentActivities(events, activities) }
          if (['completed', 'aborted', 'failed', 'interrupted'].includes(run.status)) {
            completed.set(run.id, { signature, group })
            while (completed.size > 32) completed.delete(completed.keys().next().value!)
          }
          const previous = store.getSnapshot().find((entry) => entry.run.id === run.id)
          return previous && JSON.stringify(previous) === JSON.stringify(group) ? previous : group
        }))
        if (disposed) return
        for (const group of groups) {
          for (const activity of group.activities) {
            if (!('call' in activity) || !('result' in activity) || activity.result?.status !== 'success' || !['edit', 'write'].includes(activity.call.toolName)) continue
            const key = `${group.run.id}:${activity.call.id}`
            if (refreshed.has(key)) continue
            refreshed.add(key)
            if (refreshed.size > 2048) refreshed.delete(refreshed.values().next().value!)
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
    let snapshot = chat.getSnapshot()
    const unsubscribe = chat.subscribe(() => {
      const next = chat.getSnapshot()
      if (next.current.messages !== snapshot.current.messages || next.extras.history.sinceEntry !== snapshot.extras.history.sinceEntry) schedule()
      snapshot = next
    })
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
