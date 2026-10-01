import { useEffect, useState, type ButtonHTMLAttributes } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { usePiRuntimeExtras, usePiSession, type PiThinkingLevel } from '@assistant-ui/react-pi'
import { toAgentContextUsage } from '@/shared/agent/agentContextUsage'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import type { ThinkingLevel } from '@/shared/agent/agentConfig'
import { Thread } from '../../components/assistant-ui/elements/thread.aui'
import { cn } from '@/renderer/src/lib/utils'
import { RunHistoryPanel } from '../runs/RunHistoryPanel'
import { AgentRunFocusProvider } from '../runs/AgentRunFocusContext'
import { PiExtensionUiPrompt } from './runtime/PiExtensionUiPrompt'
import { SubagentSessionPanel } from '../../components/assistant-ui/elements/subagent-session-panel.aui'

const THINKING_LEVELS = [
  { id: 'off', name: '关闭' },
  { id: 'minimal', name: '最低' },
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
  { id: 'xhigh', name: '很高' },
  { id: 'max', name: '最大' },
] as const

const isThinkingLevel = (value: string): value is ThinkingLevel =>
  THINKING_LEVELS.some((option) => option.id === value)

const toPiThinkingLevel = (level: ThinkingLevel): PiThinkingLevel => level as PiThinkingLevel

export function ChatPanel({
  settings,
  onSettingsChanged,
}: {
  settings: AgentSettingsSnapshot | null
  onSettingsChanged?: () => Promise<void>
}) {
  const [view, setView] = useState<'chat' | 'trace' | 'subagent'>('chat')
  const [switchingModel, setSwitchingModel] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [focusedRunId, setFocusedRunId] = useState<string>()
  const threadItemId = useAuiState((state) => state.threadListItem.id)
  const sessionId = useAuiState((state) => state.threadListItem.remoteId)
  const session = usePiSession()
  const piRuntime = usePiRuntimeExtras()
  const configuredModels = settings?.models ?? []
  const [globalSelection, setGlobalSelection] = useState<{
    modelId: string
    thinkingLevel: ThinkingLevel
  }>()
  const sessionModel = configuredModels.find(
    (model) =>
      model.provider === session?.config?.provider && model.modelID === session?.config?.modelId,
  )
  const selectedModel = sessionId
    ? sessionModel ??
      configuredModels.find(
        (model) => model.id === (globalSelection?.modelId ?? settings?.activeModelId),
      )
    : configuredModels.find(
        (model) => model.id === (globalSelection?.modelId ?? settings?.activeModelId),
      )
  const selectedThinkingLevel =
    session?.config?.thinkingLevel ??
    (sessionId ? sessionModel?.thinkingLevel : undefined) ??
    globalSelection?.thinkingLevel ??
    selectedModel?.thinkingLevel ??
    (isThinkingLevel(settings?.thinkingLevel ?? '') ? settings?.thinkingLevel : undefined)

  useEffect(() => {
    setFocusedRunId(undefined)
    setView('chat')
  }, [threadItemId, sessionId])

  const modelOptions = configuredModels.map((model) => {
    const catalogModel = settings?.catalog
      .find((provider) => provider.id === model.provider)
      ?.models.find((item) => item.id === model.modelID)
    const efforts = THINKING_LEVELS.filter((option) =>
      catalogModel?.availableThinkingLevels.includes(option.id),
    )

    return {
      id: model.id,
      name: model.modelName,
      description: model.providerName,
      keywords: [model.provider, model.providerName],
      efforts: efforts.length ? efforts : undefined,
    }
  })
  const saveSelection = async (
    model: (typeof configuredModels)[number],
    thinkingLevel: ThinkingLevel,
  ) => {
    if (window.api) {
      await window.api.updateAgentModelSelection({
        provider: model.provider,
        modelId: model.modelID,
        thinkingLevel,
      })
    }
    setGlobalSelection({ modelId: model.id, thinkingLevel })
  }
  const switchModel = async (id: string) => {
    const model = configuredModels.find((item) => item.id === id)
    if (!model) return
    const thinkingLevel = model.thinkingLevel ?? (model.reasoning ? 'medium' : 'off')
    setSwitchingModel(true)
    setModelError(null)
    try {
      await saveSelection(model, thinkingLevel)
      if (sessionId) {
        await piRuntime.setModel({ provider: model.provider, modelId: model.modelID })
        await piRuntime.setThinkingLevel(toPiThinkingLevel(thinkingLevel))
      }
      await onSettingsChanged?.()
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '模型切换失败')
    } finally {
      setSwitchingModel(false)
    }
  }
  const switchThinkingLevel = async (level: string) => {
    if (!isThinkingLevel(level)) return
    if (!selectedModel) return
    setSwitchingModel(true)
    setModelError(null)
    try {
      await saveSelection(selectedModel, level)
      if (sessionId) await piRuntime.setThinkingLevel(toPiThinkingLevel(level))
      await onSettingsChanged?.()
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '推理等级切换失败')
    } finally {
      setSwitchingModel(false)
    }
  }

  return (
    <AgentRunFocusProvider
      value={{
        focusRun: (runId) => {
          setFocusedRunId(runId)
          setView('subagent')
        },
      }}
    >
      <div className="relative flex h-full w-full flex-col">
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
          {focusedRunId && (
            <ViewTab active={view === 'subagent'} onClick={() => setView('subagent')}>
              子 Agent
            </ViewTab>
          )}
        </nav>
        {view === 'chat' ? (
          <div className="relative min-h-0 flex-1">
            <Thread
              composerAccessory={<PiExtensionUiPrompt />}
              contextUsage={toAgentContextUsage(piRuntime.contextUsage)}
              isCompacting={piRuntime.compaction?.active === true}
              modelSelector={{
                models: modelOptions,
                value: selectedModel?.id ?? settings?.activeModelId,
                effort:
                  selectedThinkingLevel ?? settings?.thinkingLevel,
                disabled: switchingModel || session?.status === 'running',
                onValueChange: (id) => void switchModel(id),
                onEffortChange: (level) => void switchThinkingLevel(level),
              }}
            />
          </div>
        ) : view === 'trace' ? (
          <RunHistoryPanel sessionId={sessionId} focusedRunId={focusedRunId} />
        ) : focusedRunId && sessionId ? (
          <SubagentSessionPanel
            sessionId={sessionId}
            runId={focusedRunId}
            onBack={() => {
              setFocusedRunId(undefined)
              setView('chat')
            }}
          />
        ) : (
          <div className="min-h-0 flex-1" />
        )}
      </div>
    </AgentRunFocusProvider>
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
