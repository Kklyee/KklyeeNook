import { useEffect, useState, type ButtonHTMLAttributes } from 'react'
import { useAui, useAuiState } from '@assistant-ui/react'
import {
  useChatSession,
  useChatThreadState,
  useChatRuntimeSnapshot,
  useChatStore,
} from './runtime/chat-runtime'
import type { ChatExtras } from './runtime/chat-store'
import { toAgentContextUsage } from '@kklyeenook/shared/agent/agentContextUsage'
import type { AgentSettingsSnapshot } from '@kklyeenook/shared/agent/agentSettings'
import type { ThinkingLevel } from '@kklyeenook/shared/agent/agentConfig'
import { Thread } from '../../components/assistant-ui/elements/thread.aui'
import { cn } from '@/renderer/src/lib/utils'
import { AgentRunFocusProvider } from '../runs/AgentRunFocusContext'
import { ApprovalPrompt } from './runtime/approval-prompt'
import { SubagentSessionPanel } from '../../components/assistant-ui/elements/subagent-session-panel.aui'
import { PreviewProvider } from '../preview/PreviewProvider'
import { ChatWorkspace } from '../preview/ChatWorkspace'
import { AgentActivityProvider } from './activity/AgentActivityProvider'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'
import { BOT_STATE_LABELS } from '@kklyeenook/shared/bot/bot-state'
import { BotManagement } from '../bots/bot-management'
import { Select, SelectTrigger, SelectContent, SelectItem } from '../../components/ui/select'
import { Button } from '../../components/ui/button'
import { useWorkspaces } from '../workspaces/WorkspaceProvider'

function BotWelcome() {
  const { bots, selectedBotId } = useChatRuntimeSnapshot()
  const bot = bots.find((bot) => bot.id === selectedBotId)
  return (
    <div className="mb-6 flex flex-col items-center gap-3 px-4 text-center">
      {bot && <BotAvatar avatar={bot.avatar} name={bot.name} size={60} />}
      <h1 className="text-2xl font-medium tracking-tight">
        {bot?.kind === 'coding' ? '一起开始开发吧' : '今天想做些什么？'}
      </h1>
      <p className="text-sm text-muted-foreground">{bot?.role}</p>
    </div>
  )
}
const BOT_THREAD_COMPONENTS = { Welcome: BotWelcome }

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
  const [view, setView] = useState<'chat' | 'subagent'>('chat')
  const snapshot = useChatRuntimeSnapshot()
  const store = useChatStore()
  const { workspaces } = useWorkspaces()
  const bot = snapshot.bots.find((bot) => bot.id === snapshot.selectedBotId)
  const [workspaceError, setWorkspaceError] = useState('')
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

  if (snapshot.botEditorId) return <BotManagement settings={settings} />

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
            {bot && (
              <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-4">
                <BotAvatar
                  avatar={bot.avatar}
                  name={bot.name}
                  state={snapshot.current.state}
                  size={42}
                />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-base font-semibold">{bot.name}</h1>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {bot.role}
                    {snapshot.current.metadata && snapshot.current.metadata.id !== bot.mainThreadId
                      ? ` · ${snapshot.current.metadata?.title ?? '新会话'}`
                      : ' · 主会话'}
                  </p>
                </div>
                <Select
                  value={snapshot.current.metadata?.workspaceId ?? 'none'}
                  onValueChange={(value) => {
                    if (value) {
                      setWorkspaceError('')
                      void store
                        .setWorkspace(value === 'none' ? null : value)
                        .catch((error) => setWorkspaceError(error.message))
                    }
                  }}
                >
                  <SelectTrigger
                    aria-label="当前 Workspace"
                    disabled={snapshot.current.loading || snapshot.current.projected.isRunning}
                    className="h-8 w-auto max-w-48 border-0 text-xs"
                  >
                    {workspaces.find(
                      (workspace) => workspace.id === snapshot.current.metadata?.workspaceId,
                    )?.displayName ?? '无 Workspace'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">无 Workspace</SelectItem>
                    {workspaces
                      .filter((workspace) => bot.workspaceIds.includes(workspace.id))
                      .map((workspace) => (
                        <SelectItem
                          key={workspace.id}
                          value={workspace.id}
                          disabled={workspace.status !== 'attached'}
                        >
                          {workspace.displayName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {snapshot.current.state !== 'idle' && (
                  <span className="hidden text-xs text-muted-foreground sm:inline" role="status">
                    {BOT_STATE_LABELS[snapshot.current.state]}
                  </span>
                )}
                <Button variant="ghost" size="sm" onClick={() => store.editBot(bot.id)}>
                  设置
                </Button>
              </header>
            )}
            {(snapshot.current.error || workspaceError) && (
              <p role="alert" className="px-5 py-2 text-xs text-destructive">
                {snapshot.current.error || workspaceError}
              </p>
            )}
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
              {focusedRunId && (
                <ViewTab active={view === 'subagent'} onClick={() => setView('subagent')}>
                  子 Agent
                </ViewTab>
              )}
            </nav>
            {view === 'chat' ? (
              <div className="relative min-h-0 flex-1">
                <Thread
                  components={BOT_THREAD_COMPONENTS}
                  composerPlaceholder={bot ? `发送消息给 ${bot.name}…` : undefined}
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
  const { bots, selectedBotId, selectedThreadId } = useChatRuntimeSnapshot()
  const isDraft = !!session && !selectedThreadId
  const bot = bots.find((bot) => bot.id === selectedBotId)
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
  const profileModel = configuredModels.find((model) =>
    bot?.model
      ? model.provider === bot.model.provider && model.modelID === bot.model.modelId
      : model.id === settings?.activeModelId,
  )
  const selectedModel = bot
    ? session?.status === 'running' || isDraft
      ? (sessionModel ?? profileModel)
      : profileModel
    : sessionId
      ? (sessionModel ??
        configuredModels.find(
          (model) => model.id === (globalSelection?.modelId ?? settings?.activeModelId),
        ))
      : configuredModels.find(
          (model) => model.id === (globalSelection?.modelId ?? settings?.activeModelId),
        )
  const selectedThinkingLevel =
    bot && session?.status !== 'running' && !isDraft
      ? (bot.thinkingLevel ?? profileModel?.thinkingLevel ?? settings?.thinkingLevel)
      : (session?.config?.thinkingLevel ??
        (sessionId ? sessionModel?.thinkingLevel : undefined) ??
        globalSelection?.thinkingLevel ??
        selectedModel?.thinkingLevel ??
        (isThinkingLevel(settings?.thinkingLevel ?? '') ? settings?.thinkingLevel : undefined))

  const modelOptions = configuredModels.map((model) => {
    const catalogModel = settings?.catalog
      .find((provider) => provider.id === model.provider)
      ?.models.find((item) => item.id === model.modelID)
    const availableThinkingLevels = new Set(catalogModel?.availableThinkingLevels ?? [])
    const efforts = THINKING_LEVELS.filter((option) => availableThinkingLevels.has(option.id))

    return {
      id: model.id,
      name: model.modelName,
      provider: model.provider,
      providerName: model.providerName,
      keywords: [model.provider, model.providerName],
      efforts: efforts.length ? efforts : undefined,
    }
  })
  const saveSelection = async (
    model: (typeof configuredModels)[number],
    thinkingLevel: ThinkingLevel,
  ) => {
    if (window.api && !bot) {
      await window.api.updateAgentModelSelection({
        provider: model.provider,
        modelId: model.modelID,
        thinkingLevel,
      })
    }
    if (!bot) setGlobalSelection({ modelId: model.id, thinkingLevel })
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
      if (session) {
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
      if (session) await piRuntime.setThinkingLevel(level)
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
