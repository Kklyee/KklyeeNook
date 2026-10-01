import type { ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import type { AgentStepTrace } from '@/shared/agent/agentStep'
import type { AgentRun } from '@/shared/agent/agentRun'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/renderer/src/components/ui/collapsible'
import { mono } from '@/renderer/src/lib/surfaces'
import { cn } from '@/renderer/src/lib/utils'

export function StepTrace({
  step,
  run,
  children,
}: {
  step: AgentStepTrace
  run: AgentRun
  children: ReactNode
}) {
  const start =
    step.events.find((record) => record.seq === step.startedSeq)?.timestamp ?? run.createdAt
  const end =
    step.events.find((record) => record.seq === step.endedSeq)?.timestamp ??
    run.completedAt ??
    Date.now()
  const status = step.interrupted ? 'Interrupted' : (step.result ?? 'Running')
  const tools = step.events.filter((record) => record.event.type === 'tool_started')
  const summary = tools.length
    ? tools
        .map((record) => (record.event.type === 'tool_started' ? record.event.call.toolName : ''))
        .join(' · ')
    : step.events.some((record) => record.event.type === 'text_delta')
      ? 'Final response'
      : step.events.some((record) => record.event.type === 'thinking_delta')
        ? 'Thinking'
        : 'Model request'

  return (
    <Collapsible defaultOpen={false} className="border-border/35 border-t">
      <CollapsibleTrigger className="group flex min-h-9 w-full items-center gap-2 px-4 py-2 text-left text-xs hover:bg-foreground/[0.035]">
        <ChevronDownIcon className="size-3 shrink-0 -rotate-90 transition-transform group-data-[panel-open]:rotate-0" />
        <span className="shrink-0 font-medium">Step {step.ordinal}</span>
        <span
          className={cn(
            'shrink-0 text-foreground/45',
            (step.interrupted || step.result === 'aborted') && 'text-destructive',
          )}
        >
          {status}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground/35">{summary}</span>
        <span className={cn(mono, 'text-foreground/35 tabular-nums')}>
          {(Math.max(0, end - start) / 1000).toFixed(1)}s
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
