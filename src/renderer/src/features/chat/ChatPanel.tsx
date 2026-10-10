import { useEffect, useState, type ButtonHTMLAttributes } from 'react'
import { useAui, useAuiState } from '@assistant-ui/react'
import { useChatSession, useChatThreadState } from './runtime/chat-runtime'
import type { ChatExtras } from './runtime/chat-store'
import { toAgentContextUsage } from '@/shared/agent/agentContextUsage'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import type { ThinkingLevel } from '@/shared/agent/agentConfig'
import { Thread } from '../../components/assistant-ui/elements/thread.aui'
import { cn } from '@/renderer/src/lib/utils'
import { RunHistoryPanel } from '../runs/RunHistoryPanel'
import { AgentRunFocusProvider } from '../runs/AgentRunFocusContext'
import { ApprovalPrompt } from './runtime/approval-prompt'
import { SubagentSessionPanel } from '../../components/assistant-ui/elements/subagent-session-panel.aui'
import { PreviewProvider } from '../preview/PreviewProvider'
import { ChatWorkspace } from '../preview/ChatWorkspace'
import { AgentActivityProvider } from './activity/AgentActivityProvider'

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


export function ChatPanel({
  settings,
  onSettingsChanged,
}: {
  settings: AgentSettingsSnapshot | null
  onSettingsChanged?: () => Promise<void>
}) {
  const [view, setView] = useState<'chat' | 'trace' | 'subagent'>('chat')
  const [focusedRunId, setFocusedRunId] = useState<string>()
  const threadItemId = useAuiState((state) => state.threadListItem.id)
  const sessionId = useAuiState((state) => state.threadListItem.remoteId)
  const contextUsage = useChatThreadState((state) => state.contextUsage)
  const isCompacting = useChatThreadState((state) => state.compaction.active)
  const {
    switchingModel,
    modelError,
    session,
    modelOptions,
    selectedModel,
    selectedThinkingLevel,
    switchModel,
    switchThinkingLevel,
  } = useChatModelSelection(settings, onSettingsChanged, sessionId)

  useEffect(() => {
    setFocusedRunId(undefined)
    setView('chat')
  }, [threadItemId, sessionId])

  return (
    <PreviewProvider key={threadItemId} sessionId={sessionId}>
      <AgentActivityProvider sessionId={sessionId}>
        <AgentRunFocusProvider
          value={{
            focusRun: (runId) => {
              setFocusedRunId(runId)
              setView('subagent')
            },
          }}
        >
          <ChatWorkspace>
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
                  composerAccessory={<ApprovalPrompt />}
                  contextUsage={toAgentContextUsage(contextUsage)}
                  compactionSettings={settings?.compaction}
                  isCompacting={isCompacting}
                  modelSelector={{
                    models: modelOptions,
                    value: selectedModel?.id ?? settings?.activeModelId,
                    effort: selectedThinkingLevel ?? settings?.thinkingLevel,
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
          </ChatWorkspace>
        </AgentRunFocusProvider>
      </AgentActivityProvider>
    </PreviewProvider>
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

function useChatModelSelection(
  settings: AgentSettingsSnapshot | null,
  onSettingsChanged: (() => Promise<void>) | undefined,
  sessionId: string | undefined,
) {
  const [switchingModel, setSwitchingModel] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const session = useChatSession()
  const aui = useAui()
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
    ? (sessionModel ??
      configuredModels.find(
        (model) => model.id === (globalSelection?.modelId ?? settings?.activeModelId),
      ))
    : configuredModels.find(
        (model) => model.id === (globalSelection?.modelId ?? settings?.activeModelId),
      )
  const selectedThinkingLevel =
    session?.config?.thinkingLevel ??
    (sessionId ? sessionModel?.thinkingLevel : undefined) ??
    globalSelection?.thinkingLevel ??
    selectedModel?.thinkingLevel ??
    (isThinkingLevel(settings?.thinkingLevel ?? '') ? settings?.thinkingLevel : undefined)

  const modelOptions = configuredModels.map((model) => {
    const catalogModel = settings?.catalog
      .find((provider) => provider.id === model.provider)
      ?.models.find((item) => item.id === model.modelID)
    const availableThinkingLevels = new Set(catalogModel?.availableThinkingLevels ?? [])
    const efforts = THINKING_LEVELS.filter((option) => availableThinkingLevels.has(option.id))

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
    const piRuntime = aui.thread.getState().extras as ChatExtras
    setSwitchingModel(true)
    setModelError(null)
    try {
      await saveSelection(model, thinkingLevel)
      if (sessionId) {
        await piRuntime.setModel({ provider: model.provider, modelId: model.modelID })
        await piRuntime.setThinkingLevel(thinkingLevel)
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
    const piRuntime = aui.thread.getState().extras as ChatExtras
    setSwitchingModel(true)
    setModelError(null)
    try {
      await saveSelection(selectedModel, level)
      if (sessionId) await piRuntime.setThinkingLevel(level)
      await onSettingsChanged?.()
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '推理等级切换失败')
    } finally {
      setSwitchingModel(false)
    }
  }

  return {
    switchingModel,
    modelError,
    session,
    modelOptions,
    selectedModel,
    selectedThinkingLevel,
    switchModel,
    switchThinkingLevel,
  }
}
