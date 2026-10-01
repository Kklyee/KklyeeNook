import type { ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import type { AgentTurnTrace } from '@/shared/agent/agentTurn'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/renderer/src/components/ui/collapsible'

export function TurnTrace({
  turn,
  inputs,
  children,
}: {
  turn: AgentTurnTrace
  inputs: readonly string[]
  children: ReactNode
}) {
  return (
    <Collapsible defaultOpen className="glass-subtle mx-3 my-2 overflow-hidden rounded-lg">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-foreground/[0.035]">
        <ChevronDownIcon className="size-3 -rotate-90 transition-transform group-data-[panel-open]:rotate-0" />
        <span className="font-medium">Turn {turn.ordinal}</span>
        <span className="text-foreground/40">{turn.reason ?? 'Running'}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 px-4 pb-2 text-xs text-foreground/65">
          {inputs.map((text, index) => (
            <p key={turn.inputIds[index]} className="whitespace-pre-wrap">
              {text}
            </p>
          ))}
        </div>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
