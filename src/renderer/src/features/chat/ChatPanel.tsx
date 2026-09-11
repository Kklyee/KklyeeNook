import { useState, type ButtonHTMLAttributes } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { Thread } from '../../components/assistant-ui/elements/thread.aui'
import { cn } from '@/renderer/src/lib/utils'
import { RunHistoryPanel } from '../runs/RunHistoryPanel'

export function ChatPanel({ modelName }: { modelName?: string }) {
  const [view, setView] = useState<'chat' | 'trace'>('chat')
  const sessionId = useAuiState((state) => state.threadListItem.remoteId)

  return (
    <div className="relative flex h-full w-full flex-col">
      <nav className="border-border/60 flex h-11 shrink-0 items-end gap-1 border-b px-4" aria-label="对话视图">
        <ViewTab active={view === 'chat'} onClick={() => setView('chat')}>
          对话
        </ViewTab>
        <ViewTab active={view === 'trace'} onClick={() => setView('trace')}>
          轨迹
        </ViewTab>
      </nav>
      {view === 'chat' ? (
        <div className="relative min-h-0 flex-1">
          <Thread modelName={modelName} />
        </div>
      ) : (
        <RunHistoryPanel sessionId={sessionId} />
      )}
    </div>
  )
}

function ViewTab({
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'relative h-10 px-3 text-xs font-medium transition-colors outline-none',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
        active && 'after:bg-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
      )}
      {...props}
    />
  )
}
