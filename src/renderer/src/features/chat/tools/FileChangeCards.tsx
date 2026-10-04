import { useMemo, useState, type ReactNode } from 'react'
import { createPatch, parsePatch } from 'diff'
import { ArrowRightIcon, ChevronDownIcon, SquarePlusIcon } from 'lucide-react'
import { useAui, useAuiState, type ThreadMessage } from '@assistant-ui/react'
import type { PiRuntimeExtras } from '@assistant-ui/react-pi'

import { Button } from '@/renderer/src/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'
import { usePreview, type PreviewTarget } from '@/renderer/src/features/preview/PreviewProvider'
import { normalizeToolResult } from '@/shared/tool/toolExecutionResult'
import { getStringValue, isRecord } from './toolUtils'

type FileChange = {
  operation: 'created' | 'modified'
  target: PreviewTarget
  additions?: number
  deletions?: number
}

export function FileChangeCards() {
  const content = useAuiState((state) => state.message.content)
  const status = useAuiState((state) => state.message.status?.type)
  if (status === 'running' || status === 'requires-action') return null
  if (
    !content.some(
      (part) => part.type === 'tool-call' && (part.toolName === 'write' || part.toolName === 'edit'),
    )
  )
    return null
  return <CompletedFileChangeCards content={content} />
}

function CompletedFileChangeCards({ content }: { content: ThreadMessage['content'] }) {
  const aui = useAui()
  const { open, rootPath } = usePreview()
  const [expanded, setExpanded] = useState(false)
  const files = useMemo(() => {
    const transcript =
      (aui.thread.getState().extras as PiRuntimeExtras | undefined)?.state.messages ?? []
    const results = new Map<string, unknown>()
    for (const entry of transcript) {
      if (entry.role === 'toolResult' && typeof entry.toolCallId === 'string') {
        results.set(entry.toolCallId, entry)
      }
    }
    const changes = new Map<string, FileChange>()
    for (const part of content) {
      if (part.type !== 'tool-call' || (part.toolName !== 'write' && part.toolName !== 'edit'))
        continue
      const raw = results.get(part.toolCallId) ?? part.result
      if (raw === undefined || part.isError || part.approval?.approved === false) continue
      const result = normalizeToolResult(raw, part.isError)
      if (result.status !== 'success') continue
      const path = getStringValue(part.args, 'path', 'file_path')
      if (!path) continue
      const args = isRecord(part.args) ? part.args : {}
      const details = isRecord(result.details) ? result.details : {}
      const previous = changes.get(path)
      const operation =
        previous?.operation === 'created' || details.created === true ? 'created' : 'modified'
      let diff =
        getStringValue(details, 'patch', 'diff') ?? getStringValue(args, 'patch', 'diff')
      const oldText = getTextValue(args, 'oldText', 'old_text', 'old_string', 'old')
      const newText = getTextValue(args, 'newText', 'new_text', 'new_string', 'new')
      if (part.toolName === 'edit' && !diff && oldText !== undefined && newText !== undefined)
        diff = createPatch(path, oldText, newText)
      if (part.toolName === 'write' && operation === 'created' && !diff) {
        const content = getTextValue(args, 'content', 'text')
        if (content !== undefined) diff = createPatch(path, '', content)
      }
      const stats = diff ? getPatchStats(diff) : undefined
      const hasStats = previous?.additions !== undefined || stats !== undefined
      changes.set(path, {
        operation,
        target: {
          kind: 'workspace-file',
          path,
          ...(operation === 'modified' && part.toolName === 'edit' && diff
            ? { preferredView: 'diff', diff }
            : {}),
        },
        ...(hasStats
          ? {
              additions: (previous?.additions ?? 0) + (stats?.additions ?? 0),
              deletions: (previous?.deletions ?? 0) + (stats?.deletions ?? 0),
            }
          : {}),
      })
    }
    return [...changes.values()]
  }, [aui, content])

  if (!files.length) return null

  const additions = files.reduce((total, file) => total + (file.additions ?? 0), 0)
  const deletions = files.reduce((total, file) => total + (file.deletions ?? 0), 0)
  const hasStats = files.some((file) => file.additions !== undefined || file.deletions !== undefined)

  if (files.length === 1) {
    const file = files[0]!
    const filename = file.target.path.split(/[\\/]/).pop() || file.target.path
    const label = file.operation === 'created' ? '已新增' : '已编辑'

    return (
      <section data-slot="file-change-cards" className="material-control w-full rounded-xl">
        <button
          type="button"
          aria-label={`预览 ${displayPath(file.target.path, rootPath)}`}
          onClick={() => open(file.target)}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="bg-hover flex size-10 shrink-0 items-center justify-center rounded-lg">
            <SquarePlusIcon aria-hidden="true" className="size-5 text-muted-foreground" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {label} {filename}
            </span>
            <span className="flex h-4 items-center gap-2 text-xs">
              {hasStats && (
                <span className="flex gap-2 font-mono tabular-nums group-hover:hidden">
                  <span className="text-success">+{additions}</span>
                  <span className="text-danger">-{deletions}</span>
                </span>
              )}
              <span className="hidden font-medium text-foreground group-hover:inline">查看变更</span>
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
            <SquarePlusIcon aria-hidden="true" className="size-5 text-muted-foreground" />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-medium text-foreground">
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
          className="shrink-0 gap-1.5 text-muted-foreground"
          onClick={() => open(files[0]!.target)}
        >
          查看变更
          <ArrowRightIcon aria-hidden="true" className="size-3.5" />
        </Button>
      </header>
      <div className="border-t border-border/70">
        {visibleFiles.map((file) => {
          const path = displayPath(file.target.path, rootPath)
          return (
            <FilePreviewButton
              key={file.target.path}
              aria-label={`预览 ${path}`}
              onClick={() => open(file.target)}
              className="group flex min-h-10 w-full min-w-0 items-center gap-4 px-4 py-2 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground group-hover:text-foreground">
                {path}
              </span>
              {file.additions !== undefined ? (
                <span className="flex shrink-0 gap-2 font-mono text-xs tabular-nums">
                  <span className="text-success">+{file.additions}</span>
                  <span className="text-danger">-{file.deletions ?? 0}</span>
                </span>
              ) : (
                <span className="shrink-0 text-xs text-faint-foreground">
                  {file.operation === 'created' ? '已新增' : '已修改'}
                </span>
              )}
            </FilePreviewButton>
          )
        })}
        {remaining > 0 && (
          <Button
            variant="ghost"
            className="h-10 w-full justify-start gap-2 rounded-none px-4 text-sm text-muted-foreground"
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

function FilePreviewButton({
  'aria-label': ariaLabel,
  children,
  className,
  onClick,
}: {
  'aria-label': string
  children: ReactNode
  className: string
  onClick: () => void
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={ariaLabel}
              onClick={onClick}
              className={className}
            />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side="top">查看</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function getTextValue(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key]
  }
  return undefined
}

function getPatchStats(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const patch of parsePatch(diff)) {
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) additions += 1
        if (line.startsWith('-')) deletions += 1
      }
    }
  }
  return { additions, deletions }
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
