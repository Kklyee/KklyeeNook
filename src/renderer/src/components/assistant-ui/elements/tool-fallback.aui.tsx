'use client'

import { memo, useState } from 'react'
import { resolveToolExecutionStatus } from '@/shared/tool/toolExecutionStatus'
import { formatToolResult } from '@/renderer/src/features/chat/tools/toolUtils'
import {
  type ToolApprovalOption,
  type ToolCallMessagePart,
  type ToolCallMessagePartProps,
  type ToolCallMessagePartStatus,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react'
import { Button } from '@/renderer/src/components/ui/button'
import { cn } from '@/renderer/src/lib/utils'
import { GenericToolCard } from '@/renderer/src/features/chat/tools/generic/GenericToolRenderer'

const pressable = 'active:scale-[0.98]'
function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<'div'> & { status?: ToolCallMessagePartStatus }) {
  if (status?.type !== 'incomplete') return null

  const error = status.error
  const errorText = error ? (typeof error === 'string' ? error : JSON.stringify(error)) : null

  if (!errorText) return null

  const isCancelled = status.reason === 'cancelled'
  const headerText = isCancelled ? 'Cancelled reason:' : 'Error:'

  return (
    <div
      data-slot="tool-fallback-error"
      className={cn('aui-tool-fallback-error', className)}
      {...props}
    >
      <p className="aui-tool-fallback-error-header font-semibold text-danger">{headerText}</p>
      <p className="aui-tool-fallback-error-reason text-muted-foreground">{errorText}</p>
    </div>
  )
}

const APPROVED_RESULT = 'Approved by user'
const DENIED_RESULT = 'User denied tool execution'

const APPROVAL_OPTION_DEFAULT_LABELS: Record<string, string> = {
  'allow-once': 'Allow',
  'allow-always': 'Always allow',
  'reject-once': 'Deny',
  'reject-always': 'Always deny',
}

const isKnownKind = (kind: string) => Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, kind)

const isAllowKind = (kind: string) => kind === 'allow-once' || kind === 'allow-always'

const approvalOptionLabel = (option: ToolApprovalOption) =>
  option.label ??
  (isKnownKind(option.kind) ? APPROVAL_OPTION_DEFAULT_LABELS[option.kind] : undefined) ??
  option.id

const offersInterruptAction = (
  status: ToolCallMessagePartStatus | undefined,
  approval: ToolCallMessagePart['approval'],
  interrupt: ToolCallMessagePart['interrupt'],
) =>
  status?.type !== 'requires-action' ||
  status.reason !== 'interrupt' ||
  approval != null ||
  interrupt != null

function ToolFallbackApproval({
  className,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
  status,
  ...props
}: React.ComponentProps<'div'> &
  Partial<
    Pick<ToolCallMessagePartProps, 'addResult' | 'resume' | 'respondToApproval' | 'status'>
  > & {
    interrupt?: ToolCallMessagePart['interrupt']
    approval?: ToolCallMessagePart['approval']
  }) {
  const [submitted, setSubmitted] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  if (approval != null && (approval.approved !== undefined || approval.resolution !== undefined))
    return null

  if (!offersInterruptAction(status, approval, interrupt)) return null

  const selectOptions = getInterruptSelectOptions(interrupt)

  if (selectOptions) {
    return (
      <div
        data-slot="tool-fallback-interrupt-select"
        className={cn(
          'aui-tool-fallback-interrupt-select flex flex-wrap items-center gap-2 pt-1',
          className,
        )}
        {...props}
      >
        {selectOptions.map((option, index) => (
          <Button
            key={option}
            size="sm"
            variant={index === 0 ? 'default' : 'outline'}
            className={pressable}
            onClick={() => {
              if (submitted) return
              resume?.({ value: option })
              setSubmitted(true)
            }}
            disabled={submitted}
          >
            {option}
          </Button>
        ))}
      </div>
    )
  }

  // A declared option list is a host constraint: the kit never adds an
  // approval path beyond it, but always preserves a refusal path.
  const declaredOptions = respondToApproval ? approval?.options : undefined

  const respond = (approved: boolean) => {
    if (submitted) return
    if (approval != null && approval.approved === undefined && respondToApproval) {
      respondToApproval({ approved })
    } else if (interrupt) {
      resume?.({ approved })
    } else if (status?.type === 'requires-action' && status.reason === 'interrupt') {
      return
    } else {
      addResult?.(approved ? APPROVED_RESULT : DENIED_RESULT)
    }
    setSubmitted(true)
  }

  const respondWithOption = (option: ToolApprovalOption) => {
    if (submitted) return
    // A custom kind has no decision class for the runtime to derive, and
    // responding without one throws; picking a declared option is an answer,
    // so it resolves as approved.
    respondToApproval?.(
      isKnownKind(option.kind) ? { optionId: option.id } : { optionId: option.id, approved: true },
    )
    setSubmitted(true)
    setConfirmingId(null)
  }

  const handleOption = (option: ToolApprovalOption) => {
    if (option.confirm) {
      setConfirmingId(option.id)
    } else {
      respondWithOption(option)
    }
  }

  const confirming =
    confirmingId != null ? declaredOptions?.find((o) => o.id === confirmingId) : undefined

  if (confirming) {
    return (
      <ApprovalConfirmation
        confirming={confirming}
        submitted={submitted}
        className={className}
        respondWithOption={respondWithOption}
        onBack={() => setConfirmingId(null)}
        {...props}
      />
    )
  }

  if (declaredOptions && declaredOptions.length > 0) {
    const allowOptions = declaredOptions.filter((o) => isAllowKind(o.kind))
    const customOptions = declaredOptions.filter((o) => !isKnownKind(o.kind))
    const rejectOptions = declaredOptions.filter((o) => isKnownKind(o.kind) && !isAllowKind(o.kind))
    return (
      <div
        data-slot="tool-fallback-approval"
        className={cn(
          'aui-tool-fallback-approval flex flex-wrap items-center gap-2 pt-1',
          className,
        )}
        {...props}
      >
        {[...allowOptions, ...customOptions, ...rejectOptions].map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option === allowOptions[0] ? 'default' : 'outline'}
            className={pressable}
            onClick={() => handleOption(option)}
            disabled={submitted}
          >
            {approvalOptionLabel(option)}
          </Button>
        ))}
        {rejectOptions.length === 0 && (
          <Button
            size="sm"
            variant="outline"
            className={pressable}
            onClick={() => respond(false)}
            disabled={submitted}
          >
            Deny
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      data-slot="tool-fallback-approval"
      className={cn('aui-tool-fallback-approval flex items-center gap-2 pt-1', className)}
      {...props}
    >
      <Button size="sm" className={pressable} onClick={() => respond(true)} disabled={submitted}>
        Allow
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={pressable}
        onClick={() => respond(false)}
        disabled={submitted}
      >
        Deny
      </Button>
    </div>
  )
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
  toolName,
  args,
  argsText,
  result,
  status,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
}) => {
  const isCancelled = status?.type === 'incomplete' && status.reason === 'cancelled'
  const isRequiresAction = status?.type === 'requires-action'
  const shouldRenderApproval =
    isRequiresAction && offersInterruptAction(status, approval, interrupt)

  const [open, setOpen] = useState(false)
  const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction)
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction)
    if (isRequiresAction) setOpen(true)
  }

  return (
    <GenericToolCard
      toolName={toolName}
      args={args}
      argsText={argsText}
      result={result}
      status={status}
      open={open}
      onOpenChange={setOpen}
      hideResult={isCancelled}
      details={
        <>
          <ToolFallbackError status={status} />
          {shouldRenderApproval && (
            <ToolFallbackApproval
              addResult={addResult}
              resume={resume}
              interrupt={interrupt}
              approval={approval}
              respondToApproval={respondToApproval}
              status={status}
            />
          )}
        </>
      }
    />
  )
}

const ToolFallback = memo((props: ToolCallMessagePartProps) => (
  <ToolFallbackImpl {...props} status={resolveToolExecutionStatus(props.status, props.isError, formatToolResult(props.result))} />
)) as unknown as ToolCallMessagePartComponent

ToolFallback.displayName = 'ToolFallback'

export { ToolFallback }

function getInterruptSelectOptions(interrupt: ToolCallMessagePart['interrupt']) {
  const interruptPayload = interrupt?.payload as { kind?: string; options?: unknown } | undefined
  return interruptPayload?.kind === 'select' &&
    Array.isArray(interruptPayload.options) &&
    interruptPayload.options.every((option) => typeof option === 'string')
    ? (interruptPayload.options as string[])
    : undefined
}

function ApprovalConfirmation({
  confirming,
  submitted,
  className,
  respondWithOption,
  onBack,
  ...props
}: React.ComponentProps<'div'> & {
  confirming: ToolApprovalOption
  submitted: boolean
  respondWithOption: (option: ToolApprovalOption) => void
  onBack: () => void
}) {
  const confirmMeta = typeof confirming.confirm === 'object' ? confirming.confirm : undefined
  const confirmDescription = confirmMeta?.description ?? confirming.description
  return (
    <div
      data-slot="tool-fallback-approval-confirm"
      className={cn('aui-tool-fallback-approval-confirm flex flex-col gap-2 pt-1', className)}
      {...props}
    >
      <p className="aui-tool-fallback-approval-confirm-title font-semibold text-foreground">
        {confirmMeta?.title ?? `${approvalOptionLabel(confirming)}?`}
      </p>
      {confirmDescription && (
        <p className="aui-tool-fallback-approval-confirm-description text-muted-foreground">
          {confirmDescription}
        </p>
      )}
      {confirming.grants && confirming.grants.length > 0 && (
        <ul className="aui-tool-fallback-approval-confirm-grants flex flex-col gap-1">
          {confirming.grants.map((grant) => (
            <li key={grant}>
              <code className="aui-tool-fallback-approval-confirm-grant rounded border border-border bg-surface-muted px-1.5 py-0.5 text-xs text-foreground">
                {grant}
              </code>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className={pressable}
          onClick={() => respondWithOption(confirming)}
          disabled={submitted}
        >
          Confirm
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={pressable}
          onClick={onBack}
          disabled={submitted}
        >
          Back
        </Button>
      </div>
    </div>
  )
}
