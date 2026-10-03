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
const WORKSPACE_DISPLAY_MODE_KEY = 'nook:workspace-display-mode'
const ACTIVE_WORKSPACE_ID_KEY = 'nook:active-workspace-id'

export type WorkspaceDisplayMode = 'single' | 'multiple'

export interface WorkspaceUiState {
  displayMode: WorkspaceDisplayMode
  activeWorkspaceId: string | null
}

export function notifyWorkspaceChanged(): void {
  window.dispatchEvent(new Event(WORKSPACE_CHANGED))
}

interface WorkspaceState extends WorkspaceUiState {
  workspaces: Workspace[]
  conversations: AgentSessionSummary[]
  setDisplayMode(mode: WorkspaceDisplayMode): void
  setActiveWorkspaceId(id: string | null): void
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
  const [displayMode, setDisplayModeState] = useState<WorkspaceDisplayMode>(() =>
    window.localStorage.getItem(WORKSPACE_DISPLAY_MODE_KEY) === 'multiple' ? 'multiple' : 'single',
  )
  const setDisplayMode = useCallback((mode: WorkspaceDisplayMode) => {
    window.localStorage.setItem(WORKSPACE_DISPLAY_MODE_KEY, mode)
    setDisplayModeState(mode)
  }, [])
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(
    () => window.localStorage.getItem(ACTIVE_WORKSPACE_ID_KEY) || null,
  )
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  const activeWorkspaceSelectionInitialized = useRef(
    window.localStorage.getItem(ACTIVE_WORKSPACE_ID_KEY) !== null,
  )
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
  const setActiveWorkspaceId = useCallback(
    (id: string | null) => {
      activeWorkspaceIdRef.current = id
      activeWorkspaceSelectionInitialized.current = true
      window.localStorage.setItem(ACTIVE_WORKSPACE_ID_KEY, id ?? '')
      setActiveWorkspaceIdState(id)
      setDraftWorkspaceId(id)
    },
    [setDraftWorkspaceId],
  )
  const getDraftWorkspaceId = useCallback(() => draftRef.current, [])
  const reload = useCallback(async () => {
    const [projects, sessions, settings] = await Promise.all([
      window.api.workspaces.list(),
      window.api.conversations.list(),
      window.api.getAgentSettings(),
    ])
    setDefaultMode(settings.defaultPermissionMode ?? 'workspace-write')
    const attachedWorkspaces = projects.filter((workspace) => workspace.status === 'attached')
    setWorkspaces(attachedWorkspaces)
    const currentWorkspaceId = activeWorkspaceIdRef.current
    if (
      currentWorkspaceId &&
      !attachedWorkspaces.some((workspace) => workspace.id === currentWorkspaceId)
    ) {
      setActiveWorkspaceId(attachedWorkspaces[0]?.id ?? null)
    } else if (
      attachedWorkspaces.length &&
      !currentWorkspaceId &&
      !activeWorkspaceSelectionInitialized.current
    ) {
      setActiveWorkspaceId(attachedWorkspaces[0].id)
    }
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
      displayMode,
      setDisplayMode,
      activeWorkspaceId,
      setActiveWorkspaceId,
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
      displayMode,
      setDisplayMode,
      activeWorkspaceId,
      setActiveWorkspaceId,
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
