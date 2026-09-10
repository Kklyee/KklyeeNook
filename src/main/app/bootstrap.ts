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
import { getDatabasePath, getDatabaseUrl } from '../db/databasePath'
import { createChatWindow } from '../electron/chatWindow'
import { registerWindowIpc } from '../electron/windowIpc'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { MemoryCredentialStore } from '../settings/credentialStore'
import { registerSettingsIpc } from '../settings/settingsIpc'
import { loadRenderer } from './loadRenderer'
import { DrizzleAgentSessionRepo } from '../db/repo/agentSessionRepo'

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
  const approvalPolicy = new ApprovalPolicy()
  const { database: db, close: closeDb } = await connectDatabase(getDatabaseUrl())

  app.once('will-quit', closeDb)
  console.log('[database] connected:', getDatabasePath())

  credentialStore.setApiKey(agentConfig.model.provider, apiKey)

  const runtimeFactory = createPiAgentRuntimeFactory(
    configStore,
    credentialStore,
    approvalService,
    approvalPolicy,
  )

  const sessionRepo = new DrizzleAgentSessionRepo(db)
  const agentService = new AgentService(runtimeFactory, sessionRepo)
  const chatWindow = createChatWindow()

  registerSettingsIpc(chatWindow, agentConfig, credentialStore, approvalPolicy)
  registerWindowIpc()
  registerAssistantIpc({ mainWindow: chatWindow, agentService })
  registerApprovalIpc(chatWindow, approvalService)
  registerAgentSessionIpc(agentService)

  chatWindow.on('ready-to-show', () => chatWindow.show())
  loadRenderer(chatWindow, 'chat')

  return {
    dispose() {
      closeDb()
    },
  }
}
