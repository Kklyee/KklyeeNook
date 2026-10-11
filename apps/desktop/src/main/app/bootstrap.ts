import { ExecutionContextService } from '@kklyeenook/agent/workspace/executionContextService'
import { registerRemoteIpc } from '../ipc/remoteIpc'
import { updateAgentModelSelectionFromCatalog } from '@kklyeenook/agent/settings/model-catalog'
import { WorkspacePreviewService } from '../preview/workspacePreviewService'
import { registerPreviewIpc } from '../ipc/previewIpc'
import { WorkspaceService } from '@kklyeenook/agent/workspace/workspaceService'
import { DrizzleWorkspaceRepo } from '@kklyeenook/agent/db/repositories/workspaceRepo'
import { DrizzleAgentSessionRepo } from '@kklyeenook/agent/db/repositories/agentSessionRepo'
import type { AgentConfig } from '@kklyeenook/shared/agent/agentConfig'
import type { UpdateAgentModelSelectionRequest } from '@kklyeenook/shared/agent/agentSettings'
import { app, Notification, safeStorage } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'

import { createAgentBackendProcess } from '../agent/electronProcess'
import type { AgentBackendInitOptions } from '@kklyeenook/shared/agent/backend-protocol'
import { registerAgentBackendIpc } from '../ipc/agentBackendIpc'
import { registerAgentRunIpc } from '../ipc/agentRunIpc'
import { registerAgentSkillIpc } from '../ipc/agentSkillIpc'
import { registerScheduledTaskIpc } from '../ipc/scheduledTaskIpc'
import { connectDatabase } from '@kklyeenook/agent/db/client'
import { getDatabaseUrl, getMigrationsPath } from '../db/databasePath'
import { DrizzlePermissionGrantRepo } from '@kklyeenook/agent/db/repositories/permissionGrantRepo'
import { DrizzleAgentMemoryRepo } from '@kklyeenook/agent/db/repositories/memoryRepo'
import { ContextAttachmentService } from '@kklyeenook/agent/context/contextAttachmentService'
import { registerContextIpc } from '../ipc/contextIpc'
import { createChatWindow } from '../electron/chatWindow'
import { registerWindowIpc } from '../ipc/windowIpc'
import { ApprovalPolicy } from '@kklyeenook/agent/approval/approvalPolicy'
import { AgentConfigStore } from '@kklyeenook/agent/settings/agentConfigStore'
import { registerMcpIpc } from '@/main/ipc/mcpIpc'
import { PersistentCredentialStore, type CredentialStore } from '@kklyeenook/agent/settings/credentialStore'
import {
  WEB_SEARCH_PROVIDER_NAMES,
  webSearchCredentialId,
} from '@kklyeenook/shared/web-search/webSearch'
import { registerSettingsIpc } from '../ipc/settingsIpc'
import { registerMemoryIpc } from '../ipc/memoryIpc'
import { loadRenderer } from './loadRenderer'
import { registerKnowledgeIpc } from '../ipc/knowledgeIpc'
import { registerWorkspaceIpc } from '../ipc/workspaceIpc'

export interface AppContext {
  dispose(): Promise<void>
}

export async function bootstrap(): Promise<AppContext> {
  const startedAt = performance.now()
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
        'find',
        'grep',
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
  const requiredTools = [
    'find',
    'grep',
    'save_memory',
    'delegate_task',
    'search_knowledge',
    'read_knowledge',
  ].filter((toolName) => !savedConfig.tools.enabled.includes(toolName))
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
  const disposeModelSelection = backendProcess.onModelSelection(selection => {
    configStore.set(updateAgentModelSelectionFromCatalog(configStore.get(), { provider: selection.provider, modelID: selection.modelId, thinkingLevel: selection.thinkingLevel }))
  })
  const disposeBackendNotifications = backendProcess.onNotification((notification) => {
    if (!Notification.isSupported()) return
    new Notification(notification).show()
  })
  const rendererUrl = is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
  const backendOptions: AgentBackendInitOptions = {
    remoteStaticRoot: app.isPackaged ? join(process.resourcesPath, 'remote') : join(app.getAppPath(), '..', 'remote', 'dist'),
    config: configStore.get(),
    apiKeys: collectRuntimeCredentials(configStore.get(), credentialStore),
    databaseUrl,
    migrationsPath,
    dataDir: userDataPath,
    allowedOrigins: [rendererUrl ? (URL.parse(rendererUrl)?.origin ?? 'null') : 'null'],
  }
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
        apiKeys: collectRuntimeCredentials(config, credentialStore),
      })
    },
    cancel: async () => {
      await backendProcess.request({ action: 'settings:cancel' }).catch(() => undefined)
    },
    updateModelSelection: (selection: UpdateAgentModelSelectionRequest) =>
      backendProcess.request({ action: 'settings:model-selection', selection }),
  })
  const disposeWindowIpc = registerWindowIpc(chatWindow)
  const disposeRemoteIpc = registerRemoteIpc(chatWindow, configStore, backendProcess)
  const disposeAgentRunIpc = registerAgentRunIpc(backendProcess)
  const disposeAgentSkillIpc = registerAgentSkillIpc(backendProcess)
  const disposeScheduledTaskIpc = registerScheduledTaskIpc(backendProcess)

  chatWindow.once('ready-to-show', () => {
    console.info(`[bootstrap] window ready in ${Math.round(performance.now() - startedAt)}ms`)
    chatWindow.show()
  })
  loadRenderer(chatWindow, 'chat')
  void backendProcess.start(backendOptions).then((status) => {
    if (status.state === 'unavailable') console.error('[bootstrap] agent backend unavailable')
  })
  let mainDatabaseClosed = false
  const closeMainDatabase = () => {
    if (mainDatabaseClosed) return
    mainDatabaseClosed = true
    closeDb()
  }
  app.once('will-quit', closeMainDatabase)

  return {
    async dispose() {
      disposeRemoteIpc()
      disposeModelSelection()
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

function collectRuntimeCredentials(
  config: AgentConfig,
  credentials: CredentialStore,
): Record<string, string> {
  const providers = new Set([config.model.provider, ...(config.models ?? []).map((model) => model.provider)])
  const apiKeys: Record<string, string> = {}
  for (const provider of providers) {
    const apiKey = credentials.getApiKey(provider)
    if (apiKey) apiKeys[provider] = apiKey
  }
  for (const provider of WEB_SEARCH_PROVIDER_NAMES) {
    const apiKey = credentials.getApiKey(webSearchCredentialId(provider))
    if (apiKey) apiKeys[webSearchCredentialId(provider)] = apiKey
  }
  return apiKeys
}
