'use client'

import { type ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/collapsible'
import { BranchList } from './branch-list'
import { cn } from '../lib/utils'
import { collapsePanel } from '../lib/surfaces'

export function ToolTimeline({
  open,
  onOpenChange,
  label,
  trailing,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: ReactNode
  trailing: ReactNode
  children: ReactNode
}) {
  return (
    <BranchList.Root className="w-full">
      <Collapsible
        data-slot="tool-timeline"
        open={open}
        onOpenChange={onOpenChange}
        style={{ '--animation-duration': 'var(--motion-expand)' } as React.CSSProperties}
      >
        <BranchList.Trigger>
          <CollapsibleTrigger className="group/trigger flex h-[32px] w-full min-w-0 items-center gap-2 rounded-sm bg-transparent text-left text-[13px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-strong">
            <span className="flex h-[32px] min-w-0 flex-1 items-center gap-2">
              {label}
              <ChevronRightIcon
                strokeWidth={1.5}
                className="size-3.5 shrink-0 text-faint-foreground transition-transform group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none"
              />
            </span>
            {trailing}
          </CollapsibleTrigger>
        </BranchList.Trigger>
        <CollapsibleContent className={cn(collapsePanel, 'activity-panel outline-none')}>
          <BranchList.Items className="mt-1">{children}</BranchList.Items>
        </CollapsibleContent>
      </Collapsible>
    </BranchList.Root>
  )
}
