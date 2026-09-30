import { useState } from 'react'
import { ThreadListPrimitive, useAui, useAuiState } from '@assistant-ui/react'
import { PlusIcon, ArchiveIcon } from 'lucide-react'
import type { WorkspaceAttachResult } from '@/shared/workspace/workspace'
import { Button } from '../../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { useSidebar } from '../../components/ui/sidebar'
import {
  ThreadListRoot,
  ThreadListNew,
  ThreadListItem,
} from '../../components/assistant-ui/elements/thread-list.aui'
import { useWorkspaces } from './WorkspaceProvider'

export function WorkspaceThreadList() {
  const { workspaces, reload, setDraftWorkspaceId } = useWorkspaces()
  const [pending, setPending] = useState<WorkspaceAttachResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { isMobile, state } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  const pick = async (id?: string) => {
    try {
      setError(null)
      const result = await window.api.workspaces.pick(id)
      if (result?.candidates) setPending(result)
      await reload()
    } catch (error) {
      setError(error instanceof Error ? error.message : '添加项目失败')
    }
  }
  const attach = async (relinkId?: string) => {
    if (!pending?.path) return
    try {
      await window.api.workspaces.attach({ path: pending.path, relinkId, createNew: !relinkId })
      setPending(null)
      await reload()
    } catch (error) {
      setError(error instanceof Error ? error.message : '关联失败')
    }
  }
  return (
    <ThreadListRoot>
      <ThreadListNew onClick={() => setDraftWorkspaceId(null)} />
      {!collapsed && <div className="px-2 pt-3 text-[11px] text-text-faint">Projects</div>}
      {!collapsed &&
        [
          ...workspaces.filter((item) => item.status === 'attached'),
          ...workspaces.filter((item) => item.status !== 'attached'),
        ].map((workspace) => (
          <WorkspaceThreadGroup
            key={workspace.id}
            workspaceId={workspace.id}
            label={workspace.displayName + (workspace.status === 'attached' ? '' : ' · 不可用')}
            onRelink={() => void pick(workspace.id)}
          />
        ))}
      <Button
        variant="ghost"
        size={collapsed ? 'icon' : 'sm'}
        className="justify-start text-text-muted"
        title="添加项目"
        onClick={() => void pick()}
      >
        <PlusIcon className="size-3.5" />
        {!collapsed && '添加项目'}
      </Button>
      {!collapsed && <WorkspaceThreadGroup workspaceId={null} label="未分组" />}
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发现可能存在旧项目</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-muted">选择要关联的旧项目，或将该目录作为新项目添加。</p>
          {pending?.candidates?.map((workspace) => (
            <Button key={workspace.id} variant="outline" onClick={() => void attach(workspace.id)}>
              关联旧项目 · {workspace.displayName}
            </Button>
          ))}
          <Button onClick={() => void attach()}>作为新项目添加</Button>
        </DialogContent>
      </Dialog>
    </ThreadListRoot>
  )
}

function WorkspaceThreadGroup({
  workspaceId,
  label,
  onRelink,
}: {
  workspaceId: string | null
  label: string
  onRelink?: () => void
}) {
  const { conversations, workspaces, setDraftWorkspaceId, reload } = useWorkspaces()
  const aui = useAui()
  const ids = useAuiState((s) => s.threads.threadIds)
  const items = useAuiState((s) => s.threads.threadItems)
  const [error, setError] = useState<string | null>(null)
  const workspace = workspaces.find((item) => item.id === workspaceId)
  const detach = async () => {
    try {
      await window.api.workspaces.detach(workspaceId!)
      await reload()
    } catch (error) {
      setError(error instanceof Error ? error.message : '移除失败')
    }
  }
  const indices = ids
    .map((id, index) => ({ index, item: items.find((item) => item.id === id) }))
    .filter(({ item }) => {
      const conversation = conversations.find((conversation) => conversation.id === item?.remoteId)
      return conversation && (conversation.workspaceId ?? null) === workspaceId
    })
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 px-2 pt-3 pb-1 text-[11px] text-text-faint">
        <span
          className="min-w-0 flex-1 truncate"
          title={workspace?.rootPath ?? workspace?.lastKnownPath}
        >
          {label}
        </span>
        {(!workspace || workspace.status === 'attached') && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            title={workspace ? '新建项目会话' : '新建未分组会话'}
            onClick={() => {
              setDraftWorkspaceId(workspaceId)
              void aui.threads.switchToNewThread()
            }}
          >
            <PlusIcon className="size-3" />
          </Button>
        )}
        {workspace?.status === 'attached' ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            title="移除项目"
            onClick={() => void detach()}
          >
            <ArchiveIcon className="size-3" />
          </Button>
        ) : (
          workspace && (
            <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={onRelink}>
              重新关联
            </Button>
          )
        )}
      </div>
      {indices.map(({ index }) => (
        <ThreadListPrimitive.ItemByIndex
          key={ids[index]}
          index={index}
          components={{ ThreadListItem }}
        />
      ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function WorkspaceMove() {
  const id = useAuiState((s) => s.threadListItem.remoteId)
  const { conversations, workspaces, reload } = useWorkspaces()
  const workspaceId = conversations.find((item) => item.id === id)?.workspaceId ?? null
  const [error, setError] = useState<string | null>(null)
  const move = async (next: string | null) => {
    if (!id) return
    try {
      await window.api.conversations.move({ id, workspaceId: next === 'ungrouped' ? null : next })
      await reload()
    } catch (error) {
      setError(error instanceof Error ? error.message : '移动失败')
    }
  }
  return (
    <div className="mb-1 px-1">
      <Select value={workspaceId ?? 'ungrouped'} onValueChange={(value) => void move(value)}>
        <SelectTrigger aria-label="移动会话" className="h-7 text-xs">
          移动到项目
        </SelectTrigger>
        <SelectContent>
          {workspaces
            .filter((item) => item.status === 'attached')
            .map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.displayName}
              </SelectItem>
            ))}
          <SelectItem value="ungrouped">未分组</SelectItem>
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
