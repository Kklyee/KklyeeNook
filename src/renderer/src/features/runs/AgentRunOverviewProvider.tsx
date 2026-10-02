import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentRunOverview, AgentRunOverviewStatus } from '@/shared/agent/agentRun'

const activeStatuses = new Set<AgentRunOverviewStatus>(['created', 'running', 'waiting'])
const notificationStatuses = new Set<AgentRunOverviewStatus>(['completed', 'failed'])
const queryKey = ['agent-run-overviews'] as const
const emptyOverviews: readonly AgentRunOverview[] = []
const AgentRunOverviewContext = createContext<readonly AgentRunOverview[]>(emptyOverviews)

export function useAgentRunOverviews() {
  return useQuery({
    queryKey,
    queryFn: () => window.api.listAgentRunOverviews(),
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
  })
}

export function AgentRunOverviewProvider({ children }: { children: ReactNode }) {
  const { data } = useAgentRunOverviews()
  const previousRef = useRef(new Map<string, AgentRunOverview>())
  const notifiedRunIdsRef = useRef(new Set<string>())
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!data) return

    const current = new Map(data.map((overview) => [overview.sessionId, overview]))
    if (!initializedRef.current) {
      previousRef.current = current
      initializedRef.current = true
      return
    }

    for (const overview of data) {
      const previous = previousRef.current.get(overview.sessionId)
      if (
        overview.scheduledTaskId ||
        !previous ||
        previous.runId !== overview.runId ||
        !isActiveRunStatus(previous.status) ||
        !notificationStatuses.has(overview.status) ||
        !overview.runId ||
        notifiedRunIdsRef.current.has(overview.runId)
      ) {
        continue
      }

      notifiedRunIdsRef.current.add(overview.runId)
      void showRunNotification(overview)
    }

    previousRef.current = current
  }, [data])

  return (
    <AgentRunOverviewContext.Provider value={data ?? emptyOverviews}>
      {children}
    </AgentRunOverviewContext.Provider>
  )
}

export function useAgentRunOverview(sessionId: string | undefined): AgentRunOverview | undefined {
  const overviews = useContext(AgentRunOverviewContext)
  return overviews.find((overview) => overview.sessionId === sessionId)
}

export function isActiveRunStatus(status: AgentRunOverviewStatus): boolean {
  return activeStatuses.has(status)
}

async function showRunNotification(overview: AgentRunOverview): Promise<void> {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') await Notification.requestPermission()
  if (Notification.permission !== 'granted') return

  const title = overview.sessionTitle ?? '任务'
  const result = overview.status === 'completed' ? '已完成' : '执行失败'
  new Notification('KklyeeNook', { body: `“${title}” ${result}` })
}
