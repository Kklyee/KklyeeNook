import { useAuiState } from '@assistant-ui/react'
import { FolderIcon } from 'lucide-react'
import { useWorkspaces } from './WorkspaceProvider'

export function WorkspaceComposerLabel() {
  const sessionId = useAuiState((s) => s.threadListItem.remoteId)
  const { workspaces, conversations, draftWorkspaceId } = useWorkspaces()
  const workspaceId = sessionId
    ? conversations.find((item) => item.id === sessionId)?.workspaceId
    : draftWorkspaceId
  const workspace = workspaces.find((item) => item.id === workspaceId)
  if (!workspace) return null
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 px-3 text-[11px] leading-5 text-text-faint"
      title={workspace.rootPath ?? workspace.lastKnownPath}
    >
      <FolderIcon className="size-3 shrink-0" />
      <span className="truncate">{workspace.displayName}</span>
    </div>
  )
}
