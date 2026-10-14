import { useEffect, useState, type ReactNode } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { ChevronRightIcon } from 'lucide-react'
import type { RemoteMessage } from '@kklyeenook/shared/remote/index'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@kklyeenook/ui/components/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@kklyeenook/ui/components/popover'
import { collapsePanel } from '@kklyeenook/ui/lib/surfaces'
import { InlineActivity } from './Activity'

export function ExecutionProcess({ children }: { children?: ReactNode }) {
  const execution = useAuiState((state) => state.message.metadata.custom?.execution as RemoteMessage['execution'])
  const steps = useAuiState((state) => Number(state.message.metadata.custom?.stepCount ?? 0))
  const status = useAuiState((state) => state.message.status?.type)
  const running = status === 'running' || status === 'requires-action'
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const seconds = Math.max(0, Math.floor(((running ? now : execution?.endedAt ?? now) - (execution?.startedAt ?? now)) / 1000))
  const duration = <span className="text-xs text-muted-foreground tabular-nums">{seconds >= 60 ? `${Math.floor(seconds / 60)}m ` : ''}{seconds % 60}s</span>
  const content = <div className="flex min-w-0 flex-col gap-4 pt-3"><InlineActivity />{children}</div>
  if (running || execution?.finalPartIndex === undefined || steps < 2) return <div>{duration}{content}</div>
  return <Collapsible open={open} onOpenChange={setOpen}>
    <CollapsibleTrigger className="group/trigger flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
      <span>执行过程</span>{duration}<ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open/trigger:rotate-90" />
    </CollapsibleTrigger>
    <CollapsibleContent className={collapsePanel}>{content}</CollapsibleContent>
  </Collapsible>
}

export function MessageModel() {
  const model = useAuiState((state) => state.message.metadata.custom?.model as RemoteMessage['model'])
  if (!model?.model) return null
  return <Popover>
    <PopoverTrigger openOnHover delay={150} className="min-h-11 max-w-52 truncate px-2 text-xs text-muted-foreground">{model.model.split('/').at(-1)}</PopoverTrigger>
    <PopoverContent side="top" align="start" className="w-auto max-w-[90vw] p-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt>Provider</dt><dd className="break-all">{model.provider ?? '未记录'}</dd>
        <dt>模型</dt><dd className="break-all">{model.model}</dd>
        <dt>思考等级</dt><dd>{model.thinkingLevel ?? '未记录'}</dd>
      </dl>
    </PopoverContent>
  </Popover>
}

export function FileChanges() {
  const files = useAuiState((state) => state.message.metadata.custom?.fileChanges as RemoteMessage['fileChanges'])
  const running = useAuiState((state) => state.message.status?.type === 'running' || state.message.status?.type === 'requires-action')
  const [expanded, setExpanded] = useState(false)
  if (running || !files?.length) return null
  const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  return <section className="my-3 rounded-xl border border-border bg-surface-opaque p-3" data-slot="file-change-cards">
    <div className="flex min-h-8 items-center gap-3 text-sm"><span>已更改 {files.length} 个文件</span><span className="text-success">+{additions}</span><span className="text-danger">-{deletions}</span></div>
    <ul className="mt-2 space-y-2">{(expanded ? files : files.slice(0, 3)).map((file) => <li key={file.path} className="flex gap-3 text-xs">
      <span className="min-w-0 flex-1 break-all">{file.path}</span>
      {file.additions !== undefined && <span className="shrink-0 text-success">+{file.additions}</span>}
      {file.deletions !== undefined && <span className="shrink-0 text-danger">-{file.deletions}</span>}
    </li>)}</ul>
    {files.length > 3 && <button type="button" className="mt-2 min-h-11 text-xs text-muted-foreground" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : `再显示 ${files.length - 3} 个文件`}</button>}
  </section>
}
