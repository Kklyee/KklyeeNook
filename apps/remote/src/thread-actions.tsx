import { useState } from 'react'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import type { RemoteConversationSummary } from '@kklyeenook/shared/remote/index'
import { Button } from '@kklyeenook/ui/components/button'
import { Input } from '@kklyeenook/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@kklyeenook/ui/components/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kklyeenook/ui/components/dialog'
import { api } from './api'
import { navigateBot } from './bot-pages'

export function ThreadActions({
  botId,
  thread,
  isMain,
  onRenamed,
}: {
  botId: string
  thread: RemoteConversationSummary
  isMain: boolean
  onRenamed(title: string): void
}) {
  const [dialog, setDialog] = useState<'rename' | 'delete'>()
  const [title, setTitle] = useState(thread.title)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setDialog(undefined)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label="会话操作" />}>
          <MoreHorizontalIcon />
        </PopoverTrigger>
        <PopoverContent className="w-40 space-y-1 p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-[13px]"
            onClick={() => {
              setTitle(thread.title)
              setDialog('rename')
            }}
          >
            <PencilIcon className="size-4 text-brand" />
            重命名
          </Button>
          {!isMain && (
            <>
              <Button
                variant="ghost"
                className="w-full justify-between gap-2 text-[13px]"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/conversations/${thread.id}/archive`, 'POST', {
                      archived: !thread.archived,
                    })
                    navigateBot(`/bots/${botId}`)
                  })
                }
              >
                <span className="flex items-center gap-2">
                  {thread.archived ? (
                    <ArchiveRestoreIcon className="size-4 text-muted-foreground" />
                  ) : (
                    <ArchiveIcon className="size-4 text-muted-foreground" />
                  )}
                  {thread.archived ? '恢复' : '归档'}
                </span>
                {busy && <LoaderCircleIcon className="size-4 animate-spin text-brand" />}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 text-[13px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={busy}
                onClick={() => setDialog('delete')}
              >
                <Trash2Icon className="size-4 text-destructive" />
                删除
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </PopoverContent>
      </Popover>
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === 'rename' ? '重命名会话' : '删除此会话？'}</DialogTitle>
            <DialogDescription>
              {dialog === 'delete'
                ? '正在运行的任务将取消，此会话将从列表移除。项目文件会保留。'
                : '用一个简短名称区分工作内容。'}
            </DialogDescription>
          </DialogHeader>
          {dialog === 'rename' && (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="会话名称"
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="text-[13px]" disabled={busy} onClick={() => setDialog(undefined)}>
              取消
            </Button>
            <Button
              className="text-[13px]"
              disabled={busy || (dialog === 'rename' && !title.trim())}
              variant={dialog === 'delete' ? 'destructive' : 'default'}
              onClick={() =>
                void run(async () => {
                  if (dialog === 'rename') {
                    await api(`/conversations/${thread.id}`, 'PATCH', { title: title.trim() })
                    onRenamed(title.trim())
                  } else {
                    await api(`/conversations/${thread.id}`, 'DELETE')
                    navigateBot(`/bots/${botId}`)
                  }
                })
              }
            >
              {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
              {busy ? (dialog === 'delete' ? '删除中…' : '保存中…') : '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
