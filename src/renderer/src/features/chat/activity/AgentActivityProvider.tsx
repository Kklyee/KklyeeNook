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
  const { refreshFile } = usePreview()
  const refreshPreviewFile = useEffectEvent(refreshFile)

  useEffect(() => {
    store.publish([])
    if (!sessionId) return
    let disposed = false
    let runs: AgentRun[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    const records = new Map<string, Map<number, AgentEventEnvelope>>()
    const previous = new Map<string, ActivityRun>()
    const dirty = new Set<string>()
    const loaded = new Set<string>()
    let loadVersion = 0

    const flush = () => {
      timer = undefined
      if (disposed) return
      store.publish(
        runs.map((run) => {
          const previousGroup = previous.get(run.id)
          if (previousGroup?.run === run && !dirty.has(run.id)) return previousGroup
          const existing = new Map(
            previousGroup?.activities.map((activity) => [activity.id, activity]),
          )
          const events = [...(records.get(run.id)?.values() ?? [])]
          const activities = deriveAgentActivities(events, run).map((activity) => {
            const old = existing.get(activity.id)
            return old && Object.keys(activity).every((key) => activity[key] === old[key])
              ? old
              : activity
          })
          const group = { run, activities, segments: groupAgentActivities(events, activities) }
          previous.set(run.id, group)
          dirty.delete(run.id)
          return group
        }),
      )
    }
    const schedule = () => {
      timer ??= setTimeout(flush, 100)
    }
    const append = (envelope: AgentEventEnvelope) => {
      let events = records.get(envelope.runId)
      if (!events) records.set(envelope.runId, (events = new Map()))
      events.set(envelope.seq, envelope)
      dirty.add(envelope.runId)
    }
    const load = async () => {
      const version = ++loadVersion
      const nextRuns = await window.api.listAgentRuns({ sessionId })
      if (disposed || version !== loadVersion) return
      runs = nextRuns
      await Promise.all(
        runs
          .filter((run) => !loaded.has(run.id))
          .map(async (run) => {
            loaded.add(run.id)
            let events: AgentEventEnvelope[]
            try {
              events = await window.api.listAgentExecutionRecords({ runId: run.id })
            } catch (error) {
              loaded.delete(run.id)
              throw error
            }
            if (!disposed) events.forEach(append)
          }),
      )
      schedule()
    }
    const unsubscribe = window.api.onAgentActivityEvent((envelope) => {
      if (envelope.sessionId !== sessionId) return
      append(envelope)
      const event = envelope.event
      if (event.type === 'tool_finished' && event.result.status === 'success') {
        const call = [...(records.get(envelope.runId)?.values() ?? [])].find(
          (record) =>
            record.event.type === 'tool_started' &&
            record.event.call.id === event.result.toolCallId,
        )?.event
        if (call?.type === 'tool_started' && ['edit', 'write'].includes(call.call.toolName)) {
          const args = call.call.args as Record<string, unknown>
          const path = args.path ?? args.file_path
          if (typeof path === 'string') refreshPreviewFile(path)
        }
      }
      if (
        ['agent_started', 'agent_completed', 'agent_failed', 'agent_aborted'].includes(event.type)
      ) {
        void load().catch((error) => console.error('[AgentActivity] could not load runs', error))
      }
      schedule()
    })
    void load().catch((error) =>
      console.error('[AgentActivity] could not load activity history', error),
    )
    return () => {
      disposed = true
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, store])

  return <AgentActivityContext.Provider value={store}>{children}</AgentActivityContext.Provider>
}
