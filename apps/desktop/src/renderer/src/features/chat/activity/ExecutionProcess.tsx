import { useState, type ReactNode } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { ChevronRightIcon } from 'lucide-react'
import type { AgentMessageExecution } from '@kklyeenook/shared/agent/projection'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/src/components/ui/collapsible'
import { collapsePanel } from '@/renderer/src/lib/surfaces'
import { ActivityDuration } from './AgentActivity'
import { AgentActivityGroup } from './AgentActivityGroup'
import { useActivitySelector } from './AgentActivityProvider'

export function ExecutionProcess({ children }: { children?: ReactNode }) {
  const execution = useAuiState((state) => state.message.metadata.custom?.execution as AgentMessageExecution | undefined)
  const inputId = useAuiState((state) => state.message.metadata.custom?.activityInputId as string | undefined)
  const status = useAuiState((state) => state.message.status?.type)
  const running = status === 'running' || status === 'requires-action'
  const [manualOpen, setManualOpen] = useState<boolean>()
  const startedAt = useActivitySelector((groups) =>
    groups.find((group) => inputId !== undefined && group.segments.some((segment) => segment.inputId === inputId))?.run.startedAt,
  )
  const endedAt = useActivitySelector((groups) =>
    groups.find((group) => inputId !== undefined && group.segments.some((segment) => segment.inputId === inputId))?.run.completedAt,
  )
  return (
    <Collapsible open={manualOpen ?? running} onOpenChange={setManualOpen} className="min-w-0">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 py-1 text-xs transition-colors">
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform [[data-open]>&]:rotate-90" />
        <span>{running ? '正在执行' : '执行过程'}</span>
        <span aria-hidden="true">·</span>
        <ActivityDuration startedAt={startedAt ?? execution?.startedAt} endedAt={running ? undefined : endedAt ?? execution?.endedAt} />
      </CollapsibleTrigger>
      <CollapsibleContent className={collapsePanel}>
        <div className="flex flex-col gap-4 pt-3">
          <AgentActivityGroup />
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
