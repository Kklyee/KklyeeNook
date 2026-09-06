import 'dotenv/config'
import { app, shell, BrowserWindow } from 'electron'
import { PetRuntime } from './pet/petRuntime'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { sendPetState } from './ipc/petIpc'
import { registerAgentIpc } from './ipc/agentIpc'
import { createPetWindow } from './window/petWindow'
import { createChatWindow } from './window/chatWindow'
import { registerWindowIpc } from './ipc/windowIpc'
import { registerAssistantIpc } from './ipc/assistantIpc'
import { createAgent } from './agent/createAgent'
import { MemoryCredentialStore } from './settings/credentialStore'
import { AgentConfig } from '@/shared/agent/agentConfig'
import { PIAgentAdapter } from './agent/PIAgentAdapter'

const __dirname = dirname(fileURLToPath(import.meta.url))

const agentConfig: AgentConfig = {
  model: { provider: 'deepseek', modelID: 'deepseek-v4-flash', thinkingLevel: 'off' },
  tools: { enabled: ['read', 'bash', 'edit', 'write'] },
  cwd: process.cwd(),
}

const credentialStore = new MemoryCredentialStore()

if (!process.env.API_KEY) {
  console.error(`请在 .env 中配置 ${agentConfig.model.provider} 的 API_KEY`)
  process.exit(1)
}

credentialStore.setApiKey(agentConfig.model.provider, process.env.API_KEY)
async function bootstrap() {
  try {
    const piAgent = await createAgent(agentConfig, credentialStore)
    createWindows(piAgent)
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

function createWindows(agent: PIAgentAdapter): void {
  let petRuntime: PetRuntime | null = null
  let petWindow: BrowserWindow | null = createPetWindow()
  const chatWindow = createChatWindow()

  petWindow.on('closed', () => {
    petWindow = null
  })
  chatWindow.on('ready-to-show', () => {
    chatWindow.show()
  })

  loadRenderer(petWindow, 'pet')
  loadRenderer(chatWindow, 'chat')

  if (!petRuntime) {
    petRuntime = new PetRuntime((state) => {
      if (petWindow && !petWindow.isDestroyed()) {
        sendPetState(petWindow, state)
      }
    })
    registerAgentIpc({ agent, petRuntime })
  }
  registerWindowIpc()
  registerAssistantIpc({ mainWindow: chatWindow, petRuntime, agent })
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
