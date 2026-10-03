import type { ReactNode } from 'react'
import { LoaderCircleIcon } from 'lucide-react'
import type { AgentStepTrace } from '@/shared/agent/agentStep'
import type { AgentRun } from '@/shared/agent/agentRun'
import type { AgentContextUsage } from '@/shared/agent/agentContextUsage'
import { formatContextTokens } from '@/shared/agent/contextTokens'
import { cn } from '@/renderer/src/lib/utils'

export function StepTrace({
  step,
  run,
  empty,
  inputs,
  contextUsage,
  children,
}: {
  step: AgentStepTrace
  run: AgentRun
  empty: boolean
  inputs: ReactNode
  contextUsage?: AgentContextUsage
  children: ReactNode
}) {
  const start =
    step.events.find((record) => record.seq === step.startedSeq)?.timestamp ?? run.createdAt
  const end =
    step.events.find((record) => record.seq === step.endedSeq)?.timestamp ??
    run.completedAt ??
    Date.now()
  const failed = step.interrupted || step.result === 'aborted'
  const running = !step.result && !step.interrupted
  const status = getStepStatus(step)

  return (
    <div
      data-slot="step-trace"
      data-step-id={step.id}
      className="grid grid-cols-[36px_minmax(0,1fr)] border-t border-foreground/[0.045]"
    >
      <div
        title={`Step ${step.ordinal} · ${status} · ${(Math.max(0, end - start) / 1000).toFixed(1)}s`}
        aria-label={`Step ${step.ordinal}，${status}`}
        className="flex items-start justify-center gap-[4px] whitespace-nowrap pt-[8px] text-[9px] leading-[9px] text-foreground/35"
      >
        <span
          className={cn(
            'mt-0.5 size-1 shrink-0 rounded-full',
            failed ? 'bg-destructive' : running ? 'animate-pulse bg-blue-400' : 'bg-foreground/35',
          )}
        />
        <span>#{step.ordinal}</span>
      </div>
      <div className="min-w-0">
        {inputs}
        {empty ? (
          <div className="flex h-[24px] items-center gap-[8px] px-[4px] text-[11px] text-foreground/45">
            {running && <LoaderCircleIcon className="size-3 animate-spin" />}
            {running ? '正在请求模型…' : `请求${status}`}
          </div>
        ) : (
          children
        )}
        <StepContextUsage usage={contextUsage} />
      </div>
    </div>
  )
}

function getStepStatus(step: AgentStepTrace): string {
  if (step.interrupted) return '被中断'
  if (step.result === 'aborted') return '已中止'
  return step.result ? '已提交' : '进行中'
}

function StepContextUsage({ usage }: { usage?: AgentContextUsage }) {
  if (usage?.tokens === undefined || usage.contextWindow === undefined || usage.contextWindow <= 0)
    return null
  return (
    <p
      className="px-1 py-1 text-right text-[10px] text-foreground/40 tabular-nums"
      title={`${usage.tokens.toLocaleString('en-US')} / ${usage.contextWindow.toLocaleString('en-US')} tokens`}
    >
      上下文 {formatContextTokens(usage.tokens)} / {formatContextTokens(usage.contextWindow)}
    </p>
  )
}
