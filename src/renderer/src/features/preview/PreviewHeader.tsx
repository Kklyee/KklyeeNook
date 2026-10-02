import { Maximize2, Minimize2, PanelLeft, PanelRight, X } from 'lucide-react'
import { TooltipIconButton } from '@/renderer/src/components/assistant-ui/elements/tooltip-icon-button'
import { usePreview } from './PreviewProvider'

export function PreviewHeader() {
  const preview = usePreview()
  const target = preview.target!
  const filename = target.path.split(/[\\/]/).pop() ?? target.path
  const format = filename.includes('.') ? filename.split('.').pop()!.toUpperCase() : 'TXT'

  return (
    <header className="border-border/60 flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
      <div className="glass-surface flex min-w-0 items-center gap-2 rounded-md px-2 py-1">
        <span className="text-muted-foreground shrink-0 font-mono text-[10px]">{format}</span>
        <span className="truncate text-xs" title={target.path}>
          {filename}
        </span>
        <TooltipIconButton tooltip="关闭预览" onClick={preview.close}>
          <X />
        </TooltipIconButton>
      </div>
      <div className="flex shrink-0 gap-1">
        <TooltipIconButton
          tooltip="停靠左侧"
          disabled={preview.placement === 'left'}
          onClick={preview.dockLeft}
        >
          <PanelLeft />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip={preview.placement === 'focus' ? '恢复布局' : '专注预览'}
          onClick={preview.placement === 'focus' ? preview.restore : preview.focus}
        >
          {preview.placement === 'focus' ? <Minimize2 /> : <Maximize2 />}
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="停靠右侧"
          disabled={preview.placement === 'right'}
          onClick={preview.dockRight}
        >
          <PanelRight />
        </TooltipIconButton>
      </div>
    </header>
  )
}
