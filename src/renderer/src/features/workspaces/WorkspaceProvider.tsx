import { type PermissionMode } from '@/shared/approval/permission'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Workspace } from '@/shared/workspace/workspace'
import type { AgentSessionSummary } from '@/shared/agent/agentSession'

export const WORKSPACE_CHANGED = 'nook:workspace-changed'
export function notifyWorkspaceChanged(): void {
  window.dispatchEvent(new Event(WORKSPACE_CHANGED))
}

interface WorkspaceState {
  workspaces: Workspace[]
  conversations: AgentSessionSummary[]
  draftMode: PermissionMode | null
  defaultMode: PermissionMode
  setDraftMode(mode: PermissionMode): void
  getDraftMode(): PermissionMode | null
  draftWorkspaceId: string | null
  setDraftWorkspaceId(id: string | null): void
  getDraftWorkspaceId(): string | null
  reload(): Promise<void>
}
const WorkspaceContext = createContext<WorkspaceState | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [draftMode, setDraftModeState] = useState<PermissionMode | null>(null)
  const [defaultMode, setDefaultMode] = useState<PermissionMode>('workspace-write')
  const modeRef = useRef<PermissionMode | null>(null)
  const setDraftMode = useCallback((mode: PermissionMode) => {
    modeRef.current = mode
    setDraftModeState(mode)
  }, [])
  const getDraftMode = useCallback(() => modeRef.current, [])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [conversations, setConversations] = useState<AgentSessionSummary[]>([])
  const [draftWorkspaceId, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const setDraftWorkspaceId = useCallback((id: string | null) => {
    draftRef.current = id
    setDraft(id)
    modeRef.current = null
    setDraftModeState(null)
  }, [])
  const getDraftWorkspaceId = useCallback(() => draftRef.current, [])
  const reload = useCallback(async () => {
    const [projects, sessions, settings] = await Promise.all([
      window.api.workspaces.list(),
      window.api.conversations.list(),
      window.api.getAgentSettings(),
    ])
    setDefaultMode(settings.defaultPermissionMode ?? 'workspace-write')
    setWorkspaces(projects)
    setConversations(sessions)
  }, [])
  useEffect(() => {
    const refresh = () => {
      void reload().catch(console.error)
    }
    refresh()
    window.addEventListener(WORKSPACE_CHANGED, refresh)
    return () => window.removeEventListener(WORKSPACE_CHANGED, refresh)
  }, [reload])
  const value = useMemo(
    () => ({
      draftMode,
      defaultMode,
      setDraftMode,
      getDraftMode,
      workspaces,
      conversations,
      draftWorkspaceId,
      setDraftWorkspaceId,
      getDraftWorkspaceId,
      reload,
    }),
    [
      draftMode,
      defaultMode,
      setDraftMode,
      getDraftMode,
      workspaces,
      conversations,
      draftWorkspaceId,
      setDraftWorkspaceId,
      getDraftWorkspaceId,
      reload,
    ],
  )
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspaces(): WorkspaceState {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('WorkspaceProvider is required')
  return value
}
