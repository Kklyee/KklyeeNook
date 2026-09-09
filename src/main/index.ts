import 'dotenv/config'
import { app, shell, BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createChatWindow } from './window/chatWindow'
import { registerWindowIpc } from './ipc/windowIpc'
import { registerAssistantIpc } from './ipc/assistantIpc'
import { MemoryCredentialStore } from './settings/credentialStore'
import { AgentConfig } from '@/shared/agent/agentConfig'
import { ApprovalPolicy } from './approval/approvalPolicy'
import { ApprovalService } from './approval/approvalService'
import { registerApprovalIpc } from './ipc/approvalIpc'
import { registerSettingsIpc } from './ipc/settingsIpc'
import { AgentService } from './agent/agentService'
import { registerAgentSessionIpc } from './ipc/agentSessionIpc'
import { PIAgentRuntimeFactory } from './agent/piAgentRuntimeFactory'
import { AgentConfigStore } from './settings/agentConfigStore'

const __dirname = dirname(fileURLToPath(import.meta.url))

const agentConfig: AgentConfig = {
  model: { provider: 'deepseek', modelID: 'deepseek-v4-flash', thinkingLevel: 'off' },
  tools: { enabled: ['read', 'bash', 'edit', 'write'] },
  cwd: process.cwd(),
}

const configStore = new AgentConfigStore(agentConfig)
const credentialStore = new MemoryCredentialStore()
const approvalService = new ApprovalService()
const approvalPolicy = new ApprovalPolicy()

if (!process.env.API_KEY) {
  console.error(`请在 .env 中配置 ${agentConfig.model.provider} 的 API_KEY`)
  process.exit(1)
}

credentialStore.setApiKey(agentConfig.model.provider, process.env.API_KEY)
async function bootstrap() {
  try {
    const piRuntimeFactory = new PIAgentRuntimeFactory(
      configStore,
      credentialStore,
      approvalService,
      approvalPolicy,
    )
    const agentService = new AgentService(piRuntimeFactory)
    createWindows(agentService)
  } catch (error) {
    console.error('[bootstrap] failed:', error)
  }
}

function loadRenderer(window: BrowserWindow, windowType: 'pet' | 'chat'): void {
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('window', windowType)
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: windowType },
    })
  }
}

function createWindows(agentService: AgentService): void {
  const chatWindow = createChatWindow()
  registerSettingsIpc(chatWindow, agentConfig, credentialStore, approvalPolicy)

  chatWindow.on('ready-to-show', () => {
    chatWindow.show()
  })

  loadRenderer(chatWindow, 'chat')

  registerWindowIpc()
  registerAssistantIpc({ mainWindow: chatWindow, agentService })
  registerApprovalIpc(chatWindow, approvalService)
  registerAgentSessionIpc(agentService)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  void bootstrap()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('activate', function () {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
