import type { AgentConfig } from '@/shared/agent/agentConfig'
import { app } from 'electron'
import { AgentService } from '../agent/agentService'
import { registerAgentSessionIpc } from '../agent/ipc/agentSessionIpc'
import { registerAssistantIpc } from '../agent/ipc/assistantIpc'
import { createPiAgentRuntimeFactory } from '../agent/pi/createPiAgentRuntime'
import { registerApprovalIpc } from '../approval/approvalIpc'
import { ApprovalPolicy } from '../approval/approvalPolicy'
import { ApprovalService } from '../approval/approvalService'
import { connectDatabase } from '../db/client'
import { getDatabaseUrl, getMigrationsPath } from '../db/databasePath'
import { createChatWindow } from '../electron/chatWindow'
import { registerWindowIpc } from '../electron/windowIpc'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { MemoryCredentialStore } from '../settings/credentialStore'
import { registerSettingsIpc } from '../settings/settingsIpc'
import { loadRenderer } from './loadRenderer'
import { DrizzleAgentSessionRepo } from '../db/repo/agentSessionRepo'
import { DrizzleAgentMessageRepo } from '../db/repo/agentMessageRepo'
import { AgentMessageService } from '../agent/agentMessageService'
import { registerAgentMessageIpc } from '../agent/ipc/agentMessageIpc'
import { DrizzleAgentRuntimeStateRepo } from '../db/repo/agentRuntimeStateRepo'
import { join } from 'node:path'
import { DrizzleAgentRunRepo } from '../db/repo/agentRunRepo'
import { DrizzleAgentExecutionRecordRepo } from '../db/repo/agentExecutionRecordRepo'
import { ToolRegistry } from '../tools/toolRegistry'
import { registerPiBuiltinTools } from '../agent/pi/piBuiltinToolAdapter'
import { DrizzlePermissionGrantRepo } from '../db/repo/permissionGrantRepo'

export interface AppContext {
  dispose(): void
}

const agentConfig: AgentConfig = {
  model: { provider: 'deepseek', modelID: 'deepseek-v4-flash', thinkingLevel: 'off' },
  tools: { enabled: ['read', 'bash', 'edit', 'write'] },
  cwd: process.cwd(),
}

export async function bootstrap(): Promise<AppContext> {
  const apiKey = process.env.API_KEY
  if (!apiKey) {
    throw new Error(`请在 .env 中配置 ${agentConfig.model.provider} 的 API_KEY`)
  }

  const configStore = new AgentConfigStore(agentConfig)
  const credentialStore = new MemoryCredentialStore()
  const approvalService = new ApprovalService()
  const { database: db, close: closeDb } = await connectDatabase(
    getDatabaseUrl(),
    getMigrationsPath(),
  )
  const permissionGrantRepo = new DrizzlePermissionGrantRepo(db)
  const approvalPolicy = new ApprovalPolicy(permissionGrantRepo, agentConfig.cwd ?? process.cwd())

  credentialStore.setApiKey(agentConfig.model.provider, apiKey)

  const runtimeStateRepo = new DrizzleAgentRuntimeStateRepo(db)
  const sessionDir = join(app.getAppPath(), '.pi-sessions')
  const toolRegistry = new ToolRegistry()
  registerPiBuiltinTools(toolRegistry, agentConfig.cwd ?? process.cwd())

  const runtimeFactory = createPiAgentRuntimeFactory(
    configStore,
    credentialStore,
    approvalService,
    approvalPolicy,
    runtimeStateRepo,
    toolRegistry,
    sessionDir,
  )

  const sessionRepo = new DrizzleAgentSessionRepo(db)
  const runRepo = new DrizzleAgentRunRepo(db)
  const executionRecordRepo = new DrizzleAgentExecutionRecordRepo(db)
  const agentService = new AgentService(runtimeFactory, sessionRepo, runRepo, executionRecordRepo)

  const messageRepo = new DrizzleAgentMessageRepo(db)
  const messageService = new AgentMessageService(messageRepo)
  await agentService.initialize()
  const chatWindow = createChatWindow()

  registerSettingsIpc(chatWindow, agentConfig, credentialStore, approvalPolicy)
  registerWindowIpc()
  registerAssistantIpc({ mainWindow: chatWindow, agentService })
  registerApprovalIpc(chatWindow, approvalService)
  registerAgentSessionIpc(agentService)
  registerAgentMessageIpc(messageService)

  loadRenderer(chatWindow, 'chat')
  chatWindow.on('ready-to-show', () => chatWindow.show())
  app.once('will-quit', closeDb)

  return {
    dispose() {
      closeDb()
    },
  }
}
