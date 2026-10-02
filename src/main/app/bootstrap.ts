import { ExecutionContextService } from '../workspace/executionContextService'
import { WorkspacePreviewService } from '../preview/workspacePreviewService'
import { registerPreviewIpc } from '../preview/previewIpc'
import { WorkspaceService } from '../workspace/workspaceService'
import { DrizzleWorkspaceRepo } from '../db/repositories/workspaceRepo'
import { DrizzleAgentSessionRepo } from '../db/repositories/agentSessionRepo'
import type { AgentConfig } from '@/shared/agent/agentConfig'
import type { UpdateAgentModelSelectionRequest } from '@/shared/agent/agentSettings'
import { app, Notification, safeStorage } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'

import { createAgentBackendProcess } from '../agent-backend/electronProcess'
import type { AgentBackendInitOptions } from '../agent-backend/protocol'
import { registerAgentBackendIpc } from '../agent-backend/agentBackendIpc'
import { registerAgentRunIpc } from '../agent/ipc/agentRunIpc'
import { registerAgentSkillIpc } from '../agent/ipc/agentSkillIpc'
import { registerScheduledTaskIpc } from '../agent/ipc/scheduledTaskIpc'
import { connectDatabase } from '../db/client'
import { getDatabaseUrl, getMigrationsPath } from '../db/databasePath'
import { DrizzlePermissionGrantRepo } from '../db/repositories/permissionGrantRepo'
import { DrizzleAgentMemoryRepo } from '../db/repositories/memoryRepo'
import { ContextAttachmentService } from '../context/contextAttachmentService'
import { registerContextIpc } from '../context/contextIpc'
import { createChatWindow } from '../electron/chatWindow'
import { registerWindowIpc } from '../electron/windowIpc'
import { ApprovalPolicy } from '../approval/approvalPolicy'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { registerMcpIpc } from '@/main/mcp/mcpIpc'
import { PersistentCredentialStore, type CredentialStore } from '../settings/credentialStore'
import { registerSettingsIpc } from '../settings/settingsIpc'
import { registerMemoryIpc } from '../memory/memoryIpc'
import { loadRenderer } from './loadRenderer'
import { registerKnowledgeIpc } from '../knowledge/knowledgeIpc'
import { registerWorkspaceIpc } from '../workspace/workspaceIpc'

export interface AppContext {
  dispose(): Promise<void>
}

export async function bootstrap(): Promise<AppContext> {
  const userDataPath = app.getPath('userData')
  const defaultConfig: AgentConfig = {
    model: {
      provider: 'deepseek',
      providerName: 'DeepSeek',
      modelID: 'deepseek-v4-flash',
      thinkingLevel: 'off',
      contextWindow: 128_000,
      maxTokens: 1_000,
    },
    tools: {
      enabled: [
        'read',
        'bash',
        'edit',
        'write',
        'update_plan',
        'save_memory',
        'delegate_task',
        'search_knowledge',
        'read_knowledge',
      ],
    },
  }

  const configStore = new AgentConfigStore(defaultConfig, join(userDataPath, 'agent-settings.json'))
  const savedConfig = configStore.get()
  const requiredTools = ['save_memory', 'delegate_task', 'search_knowledge', 'read_knowledge'].filter(
    (toolName) => !savedConfig.tools.enabled.includes(toolName),
  )
  if (requiredTools.length) {
    configStore.set({
      ...savedConfig,
      tools: { ...savedConfig.tools, enabled: [...savedConfig.tools.enabled, ...requiredTools] },
    })
  }
  const credentialStore = new PersistentCredentialStore(
    join(userDataPath, 'agent-credentials.json'),
    safeStorage,
  )
  const configuredProvider = configStore.get().model.provider
  const apiKey = process.env.API_KEY
  if (apiKey && !credentialStore.hasApiKey(configuredProvider)) {
    credentialStore.setApiKey(configuredProvider, apiKey)
  }

  const databaseUrl = getDatabaseUrl()
  const migrationsPath = getMigrationsPath()
  const { database: db, close: closeDb } = await connectDatabase(databaseUrl, migrationsPath)
  const permissionGrantRepo = new DrizzlePermissionGrantRepo(db)
  const memoryRepo = new DrizzleAgentMemoryRepo(db)
  const approvalPolicy = new ApprovalPolicy(permissionGrantRepo)
  const workspaceService = new WorkspaceService(new DrizzleWorkspaceRepo(db))
  const executionContexts = new ExecutionContextService(new DrizzleAgentSessionRepo(db), workspaceService, () => configStore.get().defaultPermissionMode ?? 'workspace-write')
  const contextAttachments = new ContextAttachmentService()
  const backendProcess = createAgentBackendProcess()
  const disposeBackendNotifications = backendProcess.onNotification((notification) => {
    if (!Notification.isSupported()) return
    new Notification(notification).show()
  })
  const rendererUrl = is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
  const backendOptions: AgentBackendInitOptions = {
    config: configStore.get(),
    apiKeys: collectApiKeys(configStore.get(), credentialStore),
    databaseUrl,
    migrationsPath,
    sessionDir: join(userDataPath, 'pi-sessions'),
    allowedOrigins: [rendererUrl ? new URL(rendererUrl).origin : 'null'],
  }
  const backendStatus = await backendProcess.start(backendOptions)
  if (backendStatus.state === 'unavailable') console.error('[bootstrap] agent backend unavailable')

  const chatWindow = createChatWindow()
  const disposePreviewIpc = registerPreviewIpc(chatWindow, new WorkspacePreviewService(sessionId => executionContexts.resolve(sessionId)))
  const disposeWorkspaceIpc = registerWorkspaceIpc(chatWindow, backendProcess)
  const disposeAgentBackendIpc = registerAgentBackendIpc(chatWindow, backendProcess)
  const disposeContextIpc = registerContextIpc(chatWindow, contextAttachments, {
    stage: async (attachment) => {
      await backendProcess.request({ action: 'context:stage', attachment })
    },
    remove: async (id) => {
      await backendProcess.request({ action: 'context:remove', id })
    },
  })
  const disposeMemoryIpc = registerMemoryIpc(chatWindow, memoryRepo)
  const disposeMcpIpc = registerMcpIpc(chatWindow, backendProcess)
  const disposeKnowledgeIpc = registerKnowledgeIpc(chatWindow, backendProcess, async id => (await workspaceService.resolve(id)).rootPath)

  registerSettingsIpc(chatWindow, configStore, credentialStore, approvalPolicy, {
    prepare: async () => {
      await backendProcess.request({ action: 'settings:prepare' })
    },
    commit: async () => {
      const config = configStore.get()
      await backendProcess.request({
        action: 'settings:commit',
        config,
        apiKeys: collectApiKeys(config, credentialStore),
      })
    },
    cancel: async () => {
      await backendProcess.request({ action: 'settings:cancel' }).catch(() => undefined)
    },
    updateModelSelection: (selection: UpdateAgentModelSelectionRequest) =>
      backendProcess.request({ action: 'settings:model-selection', selection }),
  })
  const disposeWindowIpc = registerWindowIpc(chatWindow)
  const disposeAgentRunIpc = registerAgentRunIpc(backendProcess)
  const disposeAgentSkillIpc = registerAgentSkillIpc(backendProcess)
  const disposeScheduledTaskIpc = registerScheduledTaskIpc(backendProcess)

  loadRenderer(chatWindow, 'chat')
  chatWindow.on('ready-to-show', () => chatWindow.show())
  let mainDatabaseClosed = false
  const closeMainDatabase = () => {
    if (mainDatabaseClosed) return
    mainDatabaseClosed = true
    closeDb()
  }
  app.once('will-quit', closeMainDatabase)

  return {
    async dispose() {
      disposePreviewIpc()
      disposeWorkspaceIpc()
      disposeAgentBackendIpc()
      disposeAgentRunIpc()
      disposeAgentSkillIpc()
      disposeScheduledTaskIpc()
      disposeBackendNotifications()
      disposeWindowIpc()
      disposeContextIpc()
      disposeMemoryIpc()
      disposeMcpIpc()
      disposeKnowledgeIpc()
      contextAttachments.clear()
      await backendProcess.close()
      closeMainDatabase()
    },
  }
}

function collectApiKeys(config: AgentConfig, credentials: CredentialStore): Record<string, string> {
  const providers = new Set([config.model.provider, ...(config.models ?? []).map((model) => model.provider)])
  const apiKeys: Record<string, string> = {}
  for (const provider of providers) {
    const apiKey = credentials.getApiKey(provider)
    if (apiKey) apiKeys[provider] = apiKey
  }
  return apiKeys
}
