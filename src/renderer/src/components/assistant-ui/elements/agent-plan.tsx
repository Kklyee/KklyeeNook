'use client'

import type { ComponentProps } from 'react'
import { CheckIcon, CircleAlertIcon, Loader2Icon } from 'lucide-react'

import type { AgentPlanStep, AgentPlanStepStatus } from '@/shared/agent/agentPlan'
import { cn } from '@/renderer/src/lib/utils'
import { mono } from '@/renderer/src/lib/surfaces'

const statusIcon: Record<AgentPlanStepStatus, typeof CheckIcon> = {
  pending: CheckIcon,
  in_progress: Loader2Icon,
  completed: CheckIcon,
  failed: CircleAlertIcon,
}

export function AgentPlan({
  steps,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children' | 'steps'> & {
  steps: readonly AgentPlanStep[]
}) {
  const completed = steps.filter((step) => step.status === 'completed').length
  const progress = steps.length ? (completed / steps.length) * 100 : 0

  return (
    <div
      data-slot="agent-plan"
      className={cn('flex w-full max-w-sm flex-col gap-3', className)}
      {...props}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-medium">计划</span>
        <span className={cn(mono, 'text-foreground/35 tabular-nums')}>
          {completed} / {steps.length}
        </span>
      </div>
      <div className="bg-foreground/[0.06] h-[3px] w-full overflow-hidden rounded-full">
        <span
          className="bg-foreground/80 block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <ul className="flex flex-col gap-2.5">
        {steps.map((step) => {
          const Icon = statusIcon[step.status]
          const active = step.status === 'in_progress'
          const failed = step.status === 'failed'
          const done = step.status === 'completed'
          return (
            <li key={step.id} className="flex items-center gap-2.5 text-[13.5px]">
              <span className="flex size-4 shrink-0 items-center justify-center">
                {step.status === 'pending' ? (
                  <span aria-hidden className="bg-foreground/15 size-1.5 rounded-full" />
                ) : (
                  <Icon
                    className={cn(
                      'size-3.5',
                      active && 'text-foreground/90 animate-spin motion-reduce:animate-none',
                      done && 'text-foreground/35',
                      failed && 'text-destructive',
                    )}
                  />
                )}
              </span>
              <span
                className={cn(
                  done && 'text-foreground/40',
                  active && 'text-foreground/90',
                  failed && 'text-destructive',
                  step.status === 'pending' && 'text-foreground/35',
                )}
              >
                {step.title}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
