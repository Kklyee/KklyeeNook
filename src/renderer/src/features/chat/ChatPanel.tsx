import { useState, type ButtonHTMLAttributes } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { usePiSession } from '@assistant-ui/react-pi'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import type { ThinkingLevel } from '@/shared/agent/agentConfig'
import { Thread } from '../../components/assistant-ui/elements/thread.aui'
import { cn } from '@/renderer/src/lib/utils'
import { RunHistoryPanel } from '../runs/RunHistoryPanel'
import { PiExtensionUiPrompt } from './runtime/PiExtensionUiPrompt'

const THINKING_LEVELS = [
  { id: 'off', name: '关闭' },
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
] as const

const isThinkingLevel = (value: string): value is ThinkingLevel =>
  THINKING_LEVELS.some((option) => option.id === value)

export function ChatPanel({ settings }: { settings: AgentSettingsSnapshot | null }) {
  const [view, setView] = useState<'chat' | 'trace'>('chat')
  const [switchingModel, setSwitchingModel] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const sessionId = useAuiState((state) => state.threadListItem.remoteId)
  const session = usePiSession()
  const configuredModels = settings?.models ?? []
  const selectedModel = configuredModels.find(
    (model) =>
      model.provider === session?.config?.provider && model.modelID === session?.config?.modelId,
  )
  const modelOptions = configuredModels.map((model) => ({
    id: model.id,
    name: model.modelName,
    description: model.providerName,
    keywords: [model.provider, model.providerName],
    efforts: settings?.catalog
      .find((provider) => provider.id === model.provider)
      ?.models.some((catalogModel) => catalogModel.id === model.modelID && catalogModel.reasoning)
      ? THINKING_LEVELS
      : undefined,
  }))
  const switchModel = async (id: string) => {
    const model = configuredModels.find((item) => item.id === id)
    if (!sessionId || !model) return
    setSwitchingModel(true)
    setModelError(null)
    try {
      await window.api.pi.setModel(sessionId, { provider: model.provider, modelId: model.modelID })
      await window.api.pi.setThinkingLevel(sessionId, model.thinkingLevel ?? 'medium')
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '模型切换失败')
    } finally {
      setSwitchingModel(false)
    }
  }
  const switchThinkingLevel = async (level: string) => {
    if (!sessionId || !isThinkingLevel(level)) return
    setSwitchingModel(true)
    setModelError(null)
    try {
      await window.api.pi.setThinkingLevel(sessionId, level)
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '推理等级切换失败')
    } finally {
      setSwitchingModel(false)
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      <PiExtensionUiPrompt />
      {modelError && (
        <p className="bg-destructive/10 text-destructive px-4 py-2 text-xs" role="alert">
          {modelError}
        </p>
      )}
      <nav
        className="border-border/60 flex h-11 shrink-0 items-end gap-1 border-b px-4"
        aria-label="对话视图"
      >
        <ViewTab active={view === 'chat'} onClick={() => setView('chat')}>
          对话
        </ViewTab>
        <ViewTab active={view === 'trace'} onClick={() => setView('trace')}>
          轨迹
        </ViewTab>
      </nav>
      {view === 'chat' ? (
        <div className="relative min-h-0 flex-1">
          <Thread
            modelSelector={{
              models: modelOptions,
              value: selectedModel?.id ?? settings?.activeModelId,
              effort:
                session?.config?.thinkingLevel ??
                selectedModel?.thinkingLevel ??
                settings?.thinkingLevel,
              disabled: switchingModel || session?.status === 'running',
              onValueChange: (id) => void switchModel(id),
              onEffortChange: (level) => void switchThinkingLevel(level),
            }}
          />
        </div>
      ) : (
        <RunHistoryPanel sessionId={sessionId} />
      )}
    </div>
  )
}

function ViewTab({
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'relative h-10 px-3 text-xs font-medium transition-colors outline-none',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80',
        active &&
          'after:bg-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
      )}
      {...props}
    />
  )
}
