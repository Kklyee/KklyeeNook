import type { RemoteCreateConversationInput, RemoteState } from '@kklyeenook/shared/remote/index'
import { PERMISSION_LABELS } from '@kklyeenook/shared/approval/permission'
import { ModelSelectorRoot, ModelSelectorTrigger, ModelSelectorValue, ModelSelectorContent } from '@kklyeenook/ui/assistant-ui/model-selector'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kklyeenook/ui/components/select'

export type Selection = Omit<RemoteCreateConversationInput, 'prompt'>

export function Choice({ label, value, options, disabled, onChange }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  onChange(value: string): void
}) {
  return <Select value={value} onValueChange={next => { if (next) onChange(next) }} disabled={disabled}>
    <SelectTrigger aria-label={label} className="min-h-11 w-auto max-w-full text-xs"><SelectValue>{options.find(option => option.value === value)?.label ?? value}</SelectValue></SelectTrigger>
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
  const models = state.models.map(model => ({ id: JSON.stringify([model.provider, model.modelId]), name: model.name, description: model.provider }))
  const currentModel = state.models.find(model => model.provider === selection.provider && model.modelId === selection.modelId)
  return <div className="flex flex-wrap items-center gap-2">
    <Choice label="Permission" value={selection.permission} disabled={disabled} options={state.permissions.map(value => ({ value, label: PERMISSION_LABELS[value] }))} onChange={value => onPermission(value as Selection['permission'])} />
    <ModelSelectorRoot models={models} value={JSON.stringify([selection.provider, selection.modelId])} onValueChange={value => { const [provider, modelId] = JSON.parse(value); onModel({ provider, modelId }) }}>
      <ModelSelectorTrigger disabled={disabled} aria-label="Model" className="min-h-11 max-w-full text-xs"><ModelSelectorValue /></ModelSelectorTrigger>
      <ModelSelectorContent className="max-w-[calc(100vw-2rem)]" />
    </ModelSelectorRoot>
    <Choice label="Thinking level" value={selection.thinkingLevel} disabled={disabled || !currentModel?.supportsThinking} options={(currentModel?.thinkingLevels ?? ['off']).map(value => ({ value, label: `Thinking: ${value}` }))} onChange={onThinking} />
  </div>
}
