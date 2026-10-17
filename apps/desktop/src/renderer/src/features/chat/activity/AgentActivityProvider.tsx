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

const activityCache = new Map<string, readonly ActivityRun[]>()

function createActivityStore(initial: readonly ActivityRun[] = [], ready = true) {
  let groups = initial
  let loaded = ready
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => groups,
    getReady: () => loaded,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish: (next: readonly ActivityRun[]) => {
      if (loaded && groups.length === next.length && groups.every((group, index) => group === next[index])) return
      loaded = true
      groups = next
      listeners.forEach((listener) => listener())
    },
  }
}

const AgentActivityContext = createContext(createActivityStore())

export function useActivitySelector<T>(selector: (groups: readonly ActivityRun[]) => T): T {
  const store = useContext(AgentActivityContext)
  const groups = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return selector(groups)
}

export function useActivityReady() {
  const store = useContext(AgentActivityContext)
  return useSyncExternalStore(store.subscribe, store.getReady)
}

export function AgentActivityProvider(props: { sessionId?: string; children: ReactNode }) {
  return <SessionActivityProvider key={props.sessionId} {...props} />
}

function SessionActivityProvider({
  sessionId,
  children,
}: {
  sessionId?: string
  children: ReactNode
}) {
  const chat = useChatStore()
  const [store] = useState(() => {
    const cached = sessionId ? activityCache.get(sessionId) : undefined
    const current = chat.getSnapshot().current
    return createActivityStore(cached, !sessionId || cached !== undefined || (!current.loading && !current.projected.messages.length))
  })
  const { refreshFile } = usePreview()
  const refreshPreviewFile = useEffectEvent(refreshFile)

  useEffect(() => {
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
        activityCache.delete(sessionId)
        activityCache.set(sessionId, groups)
        while (activityCache.size > 8) activityCache.delete(activityCache.keys().next().value!)
        store.publish(groups)
      } catch (error) {
        if (!disposed) store.publish(store.getSnapshot())
        throw error
      } finally {
        loading = false
        if (!disposed && dirty) schedule()
      }
    }
    let snapshot = chat.getSnapshot()
    const unsubscribe = chat.subscribe(() => {
      const next = chat.getSnapshot()
      if (snapshot.current.loading && !next.current.loading) void load().catch(error => console.error('[AgentActivity] could not load activity history', error))
      else if (next.current.messages !== snapshot.current.messages || next.extras.history.sinceEntry !== snapshot.extras.history.sinceEntry) schedule()
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
