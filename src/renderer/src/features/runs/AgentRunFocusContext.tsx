import { createContext, useContext } from 'react'

interface AgentRunFocusContextValue {
  focusRun: (runId: string) => void
}

const AgentRunFocusContext = createContext<AgentRunFocusContextValue>({ focusRun: () => undefined })

export const AgentRunFocusProvider = AgentRunFocusContext.Provider

export function useAgentRunFocus() {
  return useContext(AgentRunFocusContext)
}
