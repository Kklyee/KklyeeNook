import type { AgentConfig } from '@/shared/agent/agentConfig'
import { app, safeStorage } from 'electron'
import { AgentService } from '../agent/agentService'
import { createPiAgentRuntimeFactory } from '../agent/pi/runtime/createPiAgentRuntime'
import { ApprovalPolicy } from '../approval/approvalPolicy'
import { connectDatabase } from '../db/client'
import { getDatabaseUrl, getMigrationsPath } from '../db/databasePath'
import { createChatWindow } from '../electron/chatWindow'
import { registerWindowIpc } from '../electron/windowIpc'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { PersistentCredentialStore } from '../settings/credentialStore'
import { registerSettingsIpc } from '../settings/settingsIpc'
import { loadRenderer } from './loadRenderer'
import { DrizzleAgentSessionRepo } from '../db/repositories/agentSessionRepo'
import { DrizzleAgentMessageRepo } from '../db/repositories/agentMessageRepo'
import { DrizzleAgentRuntimeStateRepo } from '../db/repositories/agentRuntimeStateRepo'
import { join } from 'node:path'
import { DrizzleAgentRunRepo } from '../db/repositories/agentRunRepo'
import { DrizzleAgentExecutionRecordRepo } from '../db/repositories/agentExecutionRecordRepo'
import { ToolRegistry } from '../tools/toolRegistry'
import { registerPiBuiltinTools } from '../agent/pi/adapters/piBuiltinToolAdapter'
import { DrizzlePermissionGrantRepo } from '../db/repositories/permissionGrantRepo'
import { DrizzleArtifactRepo } from '../db/repositories/artifactRepo'
import { ArtifactService } from '../artifact/artifactService'
import { registerArtifactIpc } from '../artifact/artifactIpc'
import { registerPiArtifactTool } from '../agent/pi/adapters/piArtifactToolAdapter'
import { PiSessionHost } from '../agent/pi/runtime/piSessionHost'
import { PiSessionHostManager } from '../agent/pi/runtime/piSessionHostManager'
import { PiClientService } from '../agent/pi/client/piClientService'
import { registerPiClientIpc } from '../agent/pi/client/piClientIpc'
import { MessageProjectionService } from '../agent/messageProjectionService'
import { registerAgentRunIpc } from '../agent/ipc/agentRunIpc'

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
  const { database: db, close: closeDb } = await connectDatabase(
    getDatabaseUrl(),
    getMigrationsPath(),
  )
  const permissionGrantRepo = new DrizzlePermissionGrantRepo(db)
  const workspace = () => {
    const cwd = configStore.get().cwd
    if (!cwd) throw new Error('Agent workspace is not configured')
    return cwd
  }
  const approvalPolicy = new ApprovalPolicy(permissionGrantRepo, workspace)

  const runtimeStateRepo = new DrizzleAgentRuntimeStateRepo(db)
  const sessionDir = join(app.getPath('userData'), 'pi-sessions')
  const toolRegistry = new ToolRegistry()
  registerPiBuiltinTools(toolRegistry, workspace())
  registerPiArtifactTool(toolRegistry)

  const piSessionHostManager = new PiSessionHostManager(
    (sessionId) =>
      new PiSessionHost(
        sessionId,
        configStore,
        credentialStore,
        approvalPolicy,
        runtimeStateRepo,
        toolRegistry,
        sessionDir,
      ),
  )
  const runtimeFactory = createPiAgentRuntimeFactory(piSessionHostManager)

  const sessionRepo = new DrizzleAgentSessionRepo(db)
  const runRepo = new DrizzleAgentRunRepo(db)
  const executionRecordRepo = new DrizzleAgentExecutionRecordRepo(db)
  const artifactRepo = new DrizzleArtifactRepo(db)
  const agentService = new AgentService(
    runtimeFactory,
    sessionRepo,
    runRepo,
    executionRecordRepo,
    artifactRepo,
  )
  const artifactService = new ArtifactService(artifactRepo, workspace)

  await agentService.initialize()
  const messageProjection = new MessageProjectionService(new DrizzleAgentMessageRepo(db))
  const piClientService = new PiClientService(
    agentService,
    piSessionHostManager,
    messageProjection,
    configStore,
    artifactService,
  )
  const chatWindow = createChatWindow()

  registerSettingsIpc(chatWindow, configStore, credentialStore, approvalPolicy, () => {
    piSessionHostManager.reloadConfiguration()
  })
  registerWindowIpc()
  registerPiClientIpc(chatWindow, piClientService)
  registerAgentRunIpc(agentService)
  registerArtifactIpc(chatWindow, artifactService)

  loadRenderer(chatWindow, 'chat')
  chatWindow.on('ready-to-show', () => chatWindow.show())
  app.once('will-quit', closeDb)

  return {
    dispose() {
      piClientService.dispose()
      piSessionHostManager.dispose()
      closeDb()
    },
  }
}
