import { useMemo, useState } from 'react'
import { ArrowRightIcon, ChevronDownIcon, FilePenIcon } from 'lucide-react'
import { useAuiState, type ThreadMessage } from '@assistant-ui/react'
import { Button } from '@/renderer/src/components/ui/button'
import { usePreview } from '@/renderer/src/features/preview/PreviewProvider'
import {
  collectAgentFileChanges,
  isFileChangeTool,
} from '@kklyeenook/shared/agent/agentFileChanges'

type ToolCallPart = Extract<ThreadMessage['content'][number], { type: 'tool-call' }>

export function FileChangeCards() {
  const content = useAuiState((state) => state.message.content)
  const status = useAuiState((state) => state.message.status?.type)
  if (status === 'running' || status === 'requires-action') return null
  if (!content.some((part) => part.type === 'tool-call' && isFileChangeTool(part.toolName)))
    return null
  return <CompletedFileChangeCards content={content} />
}

function CompletedFileChangeCards({ content }: { content: ThreadMessage['content'] }) {
  const { open, rootPath } = usePreview()
  const [expanded, setExpanded] = useState(false)
  const files = useMemo(
    () =>
      collectAgentFileChanges(
        content
          .filter((part): part is ToolCallPart => part.type === 'tool-call')
          .map((part) => ({
            toolName: part.toolName,
            args: part.args,
            result: part.result,
            isError: part.isError,
            approvalRejected: part.approval?.approved === false,
          })),
      ),
    [content],
  )
  if (!files.length) return null

  const additions = files.reduce((total, file) => total + (file.additions ?? 0), 0)
  const deletions = files.reduce((total, file) => total + (file.deletions ?? 0), 0)
  const hasStats = files.some((file) => file.additions !== undefined)

  const previewTarget = (file: (typeof files)[number]) => ({
    kind: 'workspace-file' as const,
    path: file.path,
    ...(file.diff ? { preferredView: 'diff' as const, diff: file.diff } : {}),
  })

  if (files.length === 1) {
    const file = files[0]!
    const filename = file.path.split(/[\\/]/).pop() || file.path
    return (
      <section data-slot="file-change-cards" className="material-control w-full rounded-xl">
        <button
          type="button"
          aria-label={`预览 ${displayPath(file.path, rootPath)}`}
          onClick={() => open(previewTarget(file))}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="bg-hover flex size-10 shrink-0 items-center justify-center rounded-lg">
            <FilePenIcon aria-hidden="true" className="text-muted-foreground size-5" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground truncate text-[13px] font-semibold">
              {file.operation === 'created' ? '已新增' : '已编辑'} {filename}
            </span>
            <span className="flex h-4 items-center gap-2 text-xs">
              {hasStats && (
                <span className="flex gap-2 font-mono tabular-nums group-hover:hidden">
                  <span className="text-success">+{additions}</span>
                  <span className="text-danger">-{deletions}</span>
                </span>
              )}
              <span className="text-foreground hidden font-medium group-hover:inline">
                查看变更
              </span>
            </span>
          </span>
        </button>
      </section>
    )
  }

  const visibleFiles = expanded ? files : files.slice(0, 3)
  const remaining = files.length - visibleFiles.length
  return (
    <section
      data-slot="file-change-cards"
      className="material-control w-full overflow-hidden rounded-xl"
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-hover flex size-10 shrink-0 items-center justify-center rounded-lg">
            <FilePenIcon aria-hidden="true" className="text-muted-foreground size-5" />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-foreground truncate text-sm font-medium">
              已更改 {files.length} 个文件
            </span>
            {hasStats && (
              <span className="flex gap-2 font-mono text-xs tabular-nums">
                <span className="text-success">+{additions}</span>
                <span className="text-danger">-{deletions}</span>
              </span>
            )}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground shrink-0 gap-1.5"
          onClick={() => open(previewTarget(files[0]!))}
        >
          查看变更
          <ArrowRightIcon aria-hidden="true" className="size-3.5" />
        </Button>
      </header>
      <div className="border-border/70 border-t">
        {visibleFiles.map((file) => {
          const path = displayPath(file.path, rootPath)
          return (
            <button
              key={file.path}
              type="button"
              aria-label={`预览 ${path}`}
              onClick={() => open(previewTarget(file))}
              className="hover:bg-hover focus-visible:bg-hover group flex min-h-10 w-full min-w-0 items-center gap-4 px-4 py-2 text-left outline-none transition-colors"
            >
              <span className="text-muted-foreground group-hover:text-foreground min-w-0 flex-1 truncate text-[13px]">
                {path}
              </span>
              {file.additions !== undefined ? (
                <span className="flex shrink-0 gap-2 font-mono text-xs tabular-nums">
                  <span className="text-success">+{file.additions}</span>
                  <span className="text-danger">-{file.deletions ?? 0}</span>
                </span>
              ) : (
                <span className="text-faint-foreground shrink-0 text-xs">
                  {file.operation === 'created' ? '已新增' : '已修改'}
                </span>
              )}
            </button>
          )
        })}
        {remaining > 0 && (
          <Button
            variant="ghost"
            className="text-muted-foreground h-10 w-full justify-start gap-2 rounded-none px-4 text-sm"
            aria-expanded={expanded}
            onClick={() => setExpanded(true)}
          >
            再显示 {remaining} 个文件
            <ChevronDownIcon aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
    </section>
  )
}

function workspaceRelative(path: string, root?: string): string | undefined {
  const normalized = path.replaceAll('\\', '/')
  const base = root?.replaceAll('\\', '/').replace(/\/+$/, '')
  if (!base) return undefined
  const prefix = `${base.toLowerCase()}/`
  return normalized.toLowerCase().startsWith(prefix) ? normalized.slice(prefix.length) : undefined
}

function displayPath(path: string, root?: string): string {
  return workspaceRelative(path, root) ?? path.replaceAll('\\', '/')
}
