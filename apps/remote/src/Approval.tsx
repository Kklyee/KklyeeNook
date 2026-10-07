import { useState } from 'react'
import type { RemoteApproval, RemoteApprovalAnswer } from '@kklyeenook/shared/remote/index'
import { ApprovalCard } from '@kklyeenook/ui/assistant-ui/approval-card'
import { Textarea } from '@kklyeenook/ui/components/textarea'
import { Choice } from './Controls'

export function Approval({ approval, disabled, onRespond }: {
  approval: RemoteApproval
  disabled: boolean
  onRespond(input: RemoteApprovalAnswer): void
}) {
  const [value, setValue] = useState(approval.kind === 'editor' ? approval.prefill ?? '' : approval.kind === 'select' ? approval.options[0] ?? '' : '')
  return <div className="mb-3" aria-disabled={disabled}>
    <ApprovalCard state="request" title={approval.title} subtitle="Agent needs your response" className="max-w-none" description={approval.kind === 'confirm' ? approval.message : undefined} allowOnceLabel={approval.kind === 'confirm' ? 'Allow once' : 'Submit'} denyLabel={approval.kind === 'confirm' ? 'Deny' : 'Dismiss'} onAllowOnce={disabled ? undefined : () => onRespond(approval.kind === 'confirm' ? { confirmed: true } : { value })} onDeny={disabled ? undefined : () => onRespond(approval.kind === 'confirm' ? { confirmed: false } : { dismissed: true })} />
    {approval.kind === 'select' && <Choice label={approval.title} value={value} disabled={disabled} options={approval.options.map(value => ({ value, label: value }))} onChange={setValue} />}
    {(approval.kind === 'input' || approval.kind === 'editor') && <Textarea aria-label={approval.title} disabled={disabled} className="mt-2 min-h-20 text-base" value={value} placeholder={approval.kind === 'input' ? approval.placeholder : undefined} onChange={event => setValue(event.target.value)} />}
  </div>
}
