import { useState } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { ShieldCheckIcon } from 'lucide-react'
import {
  effectivePermissionMode,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  type PermissionMode,
} from '@kklyeenook/shared/approval/permission'
import { useWorkspaces } from '@/renderer/src/features/workspaces/WorkspaceProvider'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../ui/select'
import { useChatRuntimeSnapshot } from '@/renderer/src/features/chat/runtime/chat-runtime'

export function PermissionSelector() {
  const sessionId = useAuiState((s) => s.threadListItem.remoteId)
  const running = useAuiState((s) => s.thread.isRunning)
  const snapshot = useChatRuntimeSnapshot()
  const bot = snapshot.bots.find((bot) => bot.id === snapshot.selectedBotId)
  const {
    workspaces,
    conversations,
    draftWorkspaceId,
    draftMode,
    defaultMode,
    setDraftMode,
    reload,
  } = useWorkspaces()
  const [error, setError] = useState<string | null>(null)
  const session = conversations.find((item) => item.id === sessionId)
  const workspaceId = sessionId ? session?.workspaceId : draftWorkspaceId
  const workspace = workspaces.find((item) => item.id === workspaceId && item.status === 'attached')
  const mode = effectivePermissionMode(
    sessionId ? session?.permissionMode : draftMode,
    Boolean(workspace),
    defaultMode,
  )
  const change = async (next: PermissionMode | null) => {
    if (!next) return
    try {
      setError(null)
      if (sessionId) {
        await window.api.conversations.setPermission(sessionId, next)
        await reload()
      } else setDraftMode(next)
    } catch (error) {
      setError(error instanceof Error ? error.message : '权限修改失败')
    }
  }
  return (
    <div>
      <Select value={mode} onValueChange={(value) => void change(value)}>
        <SelectTrigger
          disabled={running}
          aria-label="权限模式"
          className="h-7 w-auto gap-1 border-0 text-xs text-muted-foreground"
        >
          <ShieldCheckIcon className="size-3.5" />
          {PERMISSION_LABELS[mode]}
        </SelectTrigger>
        <SelectContent>
          {PERMISSION_MODES.filter((item) => !bot || PERMISSION_MODES.indexOf(item) <= PERMISSION_MODES.indexOf(bot.permissionMode)).map((item) => (
            <SelectItem key={item} value={item} disabled={item === 'workspace-write' && !workspace}>
              {PERMISSION_LABELS[item]}
              {item === 'workspace-write' && !workspace && ' · 需要关联一个项目'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
