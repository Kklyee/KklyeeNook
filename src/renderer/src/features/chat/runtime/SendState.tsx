import { createContext, useContext } from 'react'
import { useAuiState } from '@assistant-ui/react'

export const SendStateContext = createContext<{ creating: boolean; threads: ReadonlySet<string> }>({ creating: false, threads: new Set() })

export function usePendingSend() {
  const state = useContext(SendStateContext)
  const id = useAuiState(s => s.threadListItem.remoteId)
  return id ? state.threads.has(id) : state.creating
}
