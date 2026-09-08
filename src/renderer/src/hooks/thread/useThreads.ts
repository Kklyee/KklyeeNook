import { AgentSessionSummary } from '@/shared/agent/agentSession'
import { useQuery } from '@tanstack/react-query'

export const threadKeys = { all: ['agent-sessions'] as const }

export const useThreads = () => {
  return useQuery<AgentSessionSummary[]>({
    queryKey: threadKeys.all,
    queryFn: async () => {
      const threads = await window.api.listAgentSessions()
      return threads
    },
  })
}
