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
import { useAuiState } from '@assistant-ui/react'
import { usePiThreadState } from '@assistant-ui/react-pi'
import { useWorkspaces } from '../workspaces/WorkspaceProvider'
import { normalizeToolResult } from '@/shared/tool/toolExecutionResult'

export type PreviewTarget = {
  kind: 'workspace-file'
  path: string
  preferredView?: 'file' | 'diff'
  diff?: string
}

export type PreviewPlacement = 'left' | 'right' | 'focus'

export interface PreviewState {
  target?: PreviewTarget
  placement: PreviewPlacement
  width: number
  sessionId?: string
  rootPath?: string
  revision: number
  open(target: PreviewTarget): void
  close(): void
  dockLeft(): void
  dockRight(): void
  focus(): void
  restore(): void
  resize(width: number): void
  refreshFile(path: string): void
}

const PreviewContext = createContext<PreviewState | null>(null)
const STORAGE_KEY = 'nook:preview-layout'

function readLayout(): { placement: 'left' | 'right'; width: number } {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return {
      placement: value?.placement === 'left' ? 'left' : 'right',
      width:
        typeof value?.width === 'number' && Number.isFinite(value.width)
          ? Math.min(65, Math.max(1, value.width))
          : 42,
    }
  } catch {
    return { placement: 'right', width: 42 }
  }
}

function fileKey(path: string, root?: string): string {
  let value = path.replaceAll('\\', '/')
  if (!value.startsWith('/') && !/^[a-z]:\//i.test(value) && root) {
    value = `${root.replaceAll('\\', '/')}/${value}`
  }
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  const normalized = parts.join('/')
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized
}

export function PreviewProvider({
  sessionId,
  children,
}: {
  sessionId?: string
  children: ReactNode
}) {
  const [layout] = useState(readLayout)
  const [target, setTarget] = useState<PreviewTarget>()
  const [placement, setPlacement] = useState<PreviewPlacement>(layout.placement)
  const [width, resize] = useState(layout.width)
  const [revision, setRevision] = useState(0)
  const previousDock = useRef(layout.placement)
  const { conversations, workspaces } = useWorkspaces()
  const workspaceId = conversations.find((session) => session.id === sessionId)?.workspaceId
  const root = workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath
  const current = useRef({ target, root })
  current.current = { target, root }
  const messages = useAuiState((state) => state.thread.messages)
  const transcript = usePiThreadState((state) => state.messages)
  const completedTools = useRef(new Set<string>())

  const refreshFile = useCallback((path: string) => {
    const active = current.current
    if (
      active.target?.kind === 'workspace-file' &&
      fileKey(active.target.path, active.root) === fileKey(path, active.root)
    ) {
      setRevision((value) => value + 1)
    }
  }, [])

  useEffect(() => {
    const results = new Map<string, unknown>()
    for (const entry of transcript) {
      if (entry.role === 'toolResult' && typeof entry.toolCallId === 'string')
        results.set(entry.toolCallId, entry)
    }
    for (const message of messages) {
      for (const part of message.content) {
        if (
          part.type !== 'tool-call' ||
          !results.has(part.toolCallId) ||
          (part.toolName !== 'write' && part.toolName !== 'edit') ||
          completedTools.current.has(part.toolCallId)
        )
          continue
        completedTools.current.add(part.toolCallId)
        if (normalizeToolResult(results.get(part.toolCallId), part.isError).status !== 'success')
          continue
        const path = part.args.path ?? part.args.file_path
        if (typeof path === 'string') refreshFile(path)
      }
    }
  }, [messages, transcript, refreshFile])

  useEffect(() => {
    if (placement !== 'focus') previousDock.current = placement
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ width, placement: previousDock.current }))
  }, [width, placement])

  const open = useCallback((next: PreviewTarget) => {
    setTarget(next)
    setRevision((value) => value + 1)
  }, [])
  const close = useCallback(() => {
    setTarget(undefined)
    setPlacement(previousDock.current)
  }, [])
  const dockLeft = useCallback(() => setPlacement('left'), [])
  const dockRight = useCallback(() => setPlacement('right'), [])
  const focus = useCallback(() => setPlacement('focus'), [])
  const restore = useCallback(() => setPlacement(previousDock.current), [])
  const value = useMemo(
    () => ({
      target,
      placement,
      width,
      sessionId,
      rootPath: root,
      revision,
      open,
      close,
      dockLeft,
      dockRight,
      focus,
      restore,
      resize,
      refreshFile,
    }),
    [
      target,
      placement,
      width,
      sessionId,
      root,
      revision,
      open,
      close,
      dockLeft,
      dockRight,
      focus,
      restore,
      refreshFile,
    ],
  )

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

export function usePreview(): PreviewState {
  const value = useContext(PreviewContext)
  if (!value) throw new Error('PreviewProvider is required')
  return value
}
