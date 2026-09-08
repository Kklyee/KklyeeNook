import { ipcMain, type BrowserWindow } from 'electron'
import type { AgentConfig } from '@/shared/agent/agentConfig'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { CredentialStore } from '../settings/credentialStore'
import type { ApprovalPolicy } from '../approval/approvalPolicy'

export function registerSettingsIpc(
  window: BrowserWindow,
  config: AgentConfig,
  credentials: CredentialStore,
  policy: ApprovalPolicy,
) {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (event): AgentSettingsSnapshot => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('不允许读取配置')
    }

    return {
      provider: config.model.provider,
      modelID: config.model.modelID,
      thinkingLevel: config.model.thinkingLevel ?? 'medium',
      cwd: config.cwd ?? process.cwd(),
      hasApiKey: credentials.hasApiKey(config.model.provider),
      tools: config.tools.enabled.map((name) => ({
        name,
        requiresApproval: policy.requiresApproval(name, undefined),
      })),
    }
  })
  window.once('closed', () => ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_GET))
}
