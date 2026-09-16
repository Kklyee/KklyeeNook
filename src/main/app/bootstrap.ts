import type { AgentConfig } from '@/shared/agent/agentConfig'
import { app, safeStorage } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'

import { createAgentBackendProcess } from '../agent-backend/electronProcess'
import { createBackendPiClient } from '../agent-backend/piClientProxy'
import type { AgentBackendInitOptions } from '../agent-backend/protocol'
import { registerAgentBackendIpc } from '../agent-backend/agentBackendIpc'
import { registerPiClientIpc } from '../agent/pi/client/piClientIpc'
import { registerAgentRunIpc } from '../agent/ipc/agentRunIpc'
import { connectDatabase } from '../db/client'
import { getDatabaseUrl, getMigrationsPath } from '../db/databasePath'
import { DrizzleArtifactRepo } from '../db/repositories/artifactRepo'
import { DrizzlePermissionGrantRepo } from '../db/repositories/permissionGrantRepo'
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
    tools: { enabled: ['read', 'bash', 'edit', 'write', 'create_artifact'] },
    cwd: defaultWorkspace,
  }

  const configStore = new AgentConfigStore(defaultConfig, join(userDataPath, 'agent-settings.json'))
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
  const transport = process.env.PI_TRANSPORT === 'ipc' ? 'ipc' : 'http'
  const rendererUrl = is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
  const backendOptions: AgentBackendInitOptions = {
    config: configStore.get(),
    apiKeys: collectApiKeys(configStore.get(), credentialStore),
    databaseUrl,
    migrationsPath,
    sessionDir: join(userDataPath, 'pi-sessions'),
    allowedOrigins: [rendererUrl ? new URL(rendererUrl).origin : 'null'],
    transport,
  }
  const backendStatus = await backendProcess.start(backendOptions)
  if (backendStatus.state === 'unavailable') console.error('[bootstrap] agent backend unavailable')

  const chatWindow = createChatWindow()
  const disposeAgentBackendIpc = registerAgentBackendIpc(chatWindow, backendProcess)
  const disposePiIpc =
    transport === 'ipc'
      ? registerPiClientIpc(chatWindow, createBackendPiClient(backendProcess))
      : () => undefined
  const disposeContextIpc = registerContextIpc(chatWindow, contextAttachments, {
    stage: async (attachment) => {
      await backendProcess.request({ action: 'context:stage', attachment })
    },
    remove: async (id) => {
      await backendProcess.request({ action: 'context:remove', id })
    },
  })

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
  registerWindowIpc()
  const disposeAgentRunIpc = registerAgentRunIpc(backendProcess)
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
      disposePiIpc()
      disposeAgentRunIpc()
      disposeContextIpc()
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
