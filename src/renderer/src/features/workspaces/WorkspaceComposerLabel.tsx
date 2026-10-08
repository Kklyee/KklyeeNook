import { useAuiState } from '@assistant-ui/react'
import { FolderOpenIcon } from 'lucide-react'
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
      className="text-primary/85 flex min-w-0 items-center gap-1.5 px-3 text-xs leading-5"
      title={workspace.rootPath ?? workspace.lastKnownPath}
    >
      <FolderOpenIcon className="size-3.5 shrink-0" strokeWidth={1.5} />
      <span className="truncate">{workspace.displayName}</span>
    </div>
  )
}
