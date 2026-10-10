import type { RemoteCreateConversationInput, RemoteState } from '@kklyeenook/shared/remote/index'
import { PERMISSION_LABELS } from '@kklyeenook/shared/approval/permission'
import { ModelSelectorRoot, ModelSelectorTrigger, ModelSelectorValue, ModelSelectorContent } from '@kklyeenook/ui/assistant-ui/model-selector'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kklyeenook/ui/components/select'
import { ShieldCheckIcon } from 'lucide-react'

export type Selection = Omit<RemoteCreateConversationInput, 'prompt' | 'attachments' | 'requestId'>

export function Choice({ label, value, options, disabled, compact, menuOnly, onChange }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  compact?: boolean
  menuOnly?: boolean
  onChange(value: string): void
}) {
  return <Select value={value} onValueChange={next => { if (next) onChange(next) }} disabled={disabled}>
    <SelectTrigger aria-label={label} title={options.find(option => option.value === value)?.label} className={compact ? 'mobile-permission size-11 shrink-0 justify-center rounded-full border-0 px-0 [&>svg:last-child]:hidden' : menuOnly ? 'min-h-11 w-8 justify-center rounded-r-full border-0 bg-transparent px-1 text-xs shadow-none' : 'mobile-choice min-h-11 w-auto max-w-full rounded-full border-0 text-xs'}><SelectValue className={menuOnly ? 'sr-only' : undefined}>{compact ? <ShieldCheckIcon className="size-4" /> : options.find(option => option.value === value)?.label ?? value}</SelectValue></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value} className="min-h-11">{option.label}</SelectItem>)}</SelectContent>
  </Select>
}

export function Controls({ state, selection, disabled, onPermission, onModel, onThinking }: {
  state: RemoteState
  selection: Selection
  disabled?: boolean
  onPermission(value: Selection['permission']): void
  onModel(value: { provider: string; modelId: string }): void
  onThinking(value: string): void
}) {
  const models = state.models.map(model => ({ id: JSON.stringify([model.provider, model.modelId]), name: model.name, description: model.provider, efforts: model.supportsThinking ? model.thinkingLevels.map(level => ({ id: level, name: level })) : undefined }))
  return <div className="mobile-model-controls mr-auto flex min-w-0 w-fit shrink items-center gap-1">
    <Choice compact label="Permission" value={selection.permission} disabled={disabled} options={state.permissions.map(value => ({ value, label: PERMISSION_LABELS[value] }))} onChange={value => onPermission(value as Selection['permission'])} />
    <ModelSelectorRoot models={models} value={JSON.stringify([selection.provider, selection.modelId])} effort={selection.thinkingLevel} onEffortChange={onThinking} onValueChange={value => { const [provider, modelId] = JSON.parse(value); onModel({ provider, modelId }) }}>
      <ModelSelectorTrigger disabled={disabled} aria-label="Model and thinking level" variant="muted" className="min-h-11 min-w-0 w-fit max-w-40 shrink rounded-full px-2.5 text-xs"><ModelSelectorValue className="min-w-0 truncate" /></ModelSelectorTrigger>
      <ModelSelectorContent className="max-w-[calc(100vw-2rem)]" />
    </ModelSelectorRoot>
  </div>
}
