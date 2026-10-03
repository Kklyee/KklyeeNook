import type { ToolCallMessagePartStatus } from '@assistant-ui/react'
import { ArrowRightIcon, CheckIcon, CopyIcon, FileTextIcon, MoreHorizontalIcon } from 'lucide-react'

import { Button } from '@/renderer/src/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/src/components/ui/popover'
import { usePreview } from '@/renderer/src/features/preview/PreviewProvider'
import { useCopyToClipboard } from '@/renderer/src/hooks/use-copy-to-clipboard'
import { cn } from '@/renderer/src/lib/utils'

export type FileResultOperation = 'read' | 'created' | 'modified'
export type FileResultStatus = 'running' | 'complete' | 'failed'

const OPERATION_LABEL: Record<FileResultStatus, Record<FileResultOperation, string>> = {
  running: { read: '读取中', created: '写入中', modified: '修改中' },
  complete: { read: '已读取', created: '已创建', modified: '已修改' },
  failed: { read: '读取失败', created: '写入失败', modified: '修改失败' },
}

export function resolveFileResultStatus(status: ToolCallMessagePartStatus): FileResultStatus {
  if (status.type === 'running' || status.type === 'requires-action') return 'running'
  if (status.type === 'incomplete') return 'failed'
  return 'complete'
}

function filenameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index > 0 ? filename.slice(index + 1).toUpperCase().slice(0, 4) : 'FILE'
}

function workspaceRelative(path: string, root?: string): string | undefined {
  const normalized = path.replaceAll('\\', '/')
  const base = root?.replaceAll('\\', '/').replace(/\/+$/, '')
  if (!base) return undefined
  const prefix = `${base.toLowerCase()}/`
  return normalized.toLowerCase().startsWith(prefix) ? normalized.slice(prefix.length) : undefined
}

function absolutePath(path: string, root?: string): string {
  if (/^(?:[a-z]:[\\/]|\/)/i.test(path) || !root) return path
  return `${root.replace(/[\\/]+$/, '')}/${path}`
}

export function FileResultCard({
  path,
  operation,
  status = 'complete',
  onPreview,
}: {
  path: string
  operation: FileResultOperation
  status?: FileResultStatus
  onPreview: () => void
}) {
  const { rootPath, sessionId } = usePreview()
  const { isCopied, copyToClipboard } = useCopyToClipboard()
  const filename = filenameOf(path)
  const relative = workspaceRelative(path, rootPath)
  const label = OPERATION_LABEL[status][operation]
  const detail = relative?.includes('/') ? `${label} · ${relative}` : label

  const copyContent = () => {
    if (!sessionId) return
    void window.api.preview.readWorkspaceFile({ sessionId, path }).then(
      (file) => {
        if (file.kind === 'text') copyToClipboard(file.content)
      },
      () => undefined,
    )
  }

  return (
    <div
      data-slot="file-result-card"
      data-operation={operation}
      data-status={status}
      className="material-control flex w-full min-w-0 items-center gap-1 rounded-xl py-3 ps-3 pe-1.5 transition-[border-color,box-shadow] hover:border-border-strong"
    >
      <button
        type="button"
        onClick={onPreview}
        aria-label={`预览 ${filename}`}
        className="group/file-result flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          className={cn(
            'bg-hover flex size-8 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-semibold',
            operation === 'read' ? 'text-muted-foreground' : 'text-muted-foreground',
          )}
        >
          {extensionOf(filename)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-foreground truncate text-[13px] leading-5 font-medium">
            {filename}
          </span>
          <span
            className={cn(
              'truncate text-[11px] leading-4',
              status === 'failed' ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {detail}
          </span>
        </span>
        <span className="text-muted-foreground group-hover/file-result:text-foreground flex shrink-0 items-center gap-0.5 pe-1 text-xs transition-colors">
          预览
          <ArrowRightIcon className="size-3.5" />
        </span>
      </button>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-faint-foreground hover:text-foreground"
              aria-label="文件操作"
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40 gap-0.5 p-1.5">
          <Button
            variant="ghost"
            className="justify-start text-xs font-normal"
            onClick={() => copyToClipboard(absolutePath(path, rootPath))}
          >
            {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            {isCopied ? '已复制' : '复制路径'}
          </Button>
          <Button variant="ghost" className="justify-start text-xs font-normal" onClick={copyContent}>
            <FileTextIcon className="size-3.5" />
            复制内容
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  )
}
