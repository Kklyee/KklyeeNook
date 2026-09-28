import type { AgentConfig } from '@/shared/agent/agentConfig'
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
import { DrizzleArtifactRepo } from '../db/repositories/artifactRepo'
import { DrizzlePermissionGrantRepo } from '../db/repositories/permissionGrantRepo'
import { DrizzleAgentMemoryRepo } from '../db/repositories/memoryRepo'
import { ArtifactService } from '../artifact/artifactService'
import { registerArtifactIpc } from '../artifact/artifactIpc'
import { ContextAttachmentService } from '../context/contextAttachmentService'
import { registerContextIpc } from '../context/contextIpc'
import { createChatWindow } from '../electron/chatWindow'
import { registerWindowIpc } from '../electron/windowIpc'
import { ApprovalPolicy } from '../approval/approvalPolicy'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { PersistentCredentialStore, type CredentialStore } from '../settings/credentialStore'
import { registerSettingsIpc } from '../settings/settingsIpc'
import { registerMemoryIpc } from '../memory/memoryIpc'
import { loadRenderer } from './loadRenderer'

export interface AppContext {
  dispose(): void
}

export async function bootstrap(): Promise<AppContext> {
  const userDataPath = app.getPath('userData')
  const defaultWorkspace = app.isPackaged ? app.getPath('documents') : app.getAppPath()
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
        'create_artifact',
        'update_plan',
        'save_memory',
        'delegate_task',
      ],
    },
    cwd: defaultWorkspace,
  }

  const configStore = new AgentConfigStore(defaultConfig, join(userDataPath, 'agent-settings.json'))
  const savedConfig = configStore.get()
  const requiredTools = ['save_memory', 'delegate_task'].filter(
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
  const artifactRepo = new DrizzleArtifactRepo(db)
  const approvalPolicy = new ApprovalPolicy(permissionGrantRepo)
  const workspace = () => {
    const cwd = configStore.get().cwd
    if (!cwd) throw new Error('Agent workspace is not configured')
    return cwd
  }
  const artifactService = new ArtifactService(artifactRepo, workspace)
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
  const disposeAgentBackendIpc = registerAgentBackendIpc(chatWindow, backendProcess)
  const disposeContextIpc = registerContextIpc(chatWindow, contextAttachments, {
    stage: async (attachment) => {
      await backendProcess.request({ action: 'context:stage', attachment })
    },
    remove: async (id) => {
      await backendProcess.request({ action: 'context:remove', id })
    },
  })
  const disposeMemoryIpc = registerMemoryIpc(chatWindow, memoryRepo, workspace)

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
  })
  const disposeWindowIpc = registerWindowIpc(chatWindow)
  const disposeAgentRunIpc = registerAgentRunIpc(backendProcess)
  const disposeAgentSkillIpc = registerAgentSkillIpc(backendProcess)
  const disposeScheduledTaskIpc = registerScheduledTaskIpc(backendProcess)
  registerArtifactIpc(chatWindow, artifactService)

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
    dispose() {
      disposeAgentBackendIpc()
      disposeAgentRunIpc()
      disposeAgentSkillIpc()
      disposeScheduledTaskIpc()
      disposeBackendNotifications()
      disposeWindowIpc()
      disposeContextIpc()
      disposeMemoryIpc()
      contextAttachments.clear()
      backendProcess.close()
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
