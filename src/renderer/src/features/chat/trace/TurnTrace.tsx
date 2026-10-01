import type { ReactNode } from 'react'
import type { AgentTurnTrace, TurnEndReason } from '@/shared/agent/agentTurn'
import { cn } from '@/renderer/src/lib/utils'

const REASON_LABEL: Record<TurnEndReason, string> = {
  completed: '已完成',
  next_input: '接受新输入',
  failed: '失败',
  aborted: '已中止',
  interrupted: '被中断',
}

export function TurnTrace({
  turn,
  inputs,
  children,
}: {
  turn: AgentTurnTrace
  inputs: ReactNode
  children: ReactNode
}) {
  const status = turn.reason ? REASON_LABEL[turn.reason] : '进行中'

  return (
    <section data-slot="turn-trace" data-turn-id={turn.id} className="border-t border-foreground/[0.08]">
      <div className="grid grid-cols-[36px_minmax(0,1fr)]">
        <span
          title={`Turn ${turn.ordinal} · ${status} · ${turn.steps.length} Steps`}
          className={cn(
            'overflow-hidden whitespace-nowrap bg-foreground/[0.035] pt-[6px] text-center text-[9px] leading-[12px] text-foreground/40',
            (turn.reason === 'failed' || turn.reason === 'aborted' || turn.reason === 'interrupted') && 'text-destructive',
          )}
        >
          第{turn.ordinal}轮
        </span>
        <div className="min-w-0">{inputs}</div>
      </div>
      {children}
    </section>
  )
}
