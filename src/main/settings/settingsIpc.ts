import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { AgentConfig } from '@/shared/agent/agentConfig'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { ApprovalPolicy } from '../approval/approvalPolicy'
import type { CredentialStore } from './credentialStore'
import type { DeletePermissionGrantRequest } from '@/shared/approval/approvalTypes'

export function registerSettingsIpc(
  window: BrowserWindow,
  config: AgentConfig,
  credentials: CredentialStore,
  policy: ApprovalPolicy,
) {
  const assertTrustedSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('不允许读取配置')
    }
  }

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (event): Promise<AgentSettingsSnapshot> => {
    assertTrustedSender(event)

    return {
      provider: config.model.provider,
      modelID: config.model.modelID,
      thinkingLevel: config.model.thinkingLevel ?? 'medium',
      cwd: config.cwd ?? process.cwd(),
      hasApiKey: credentials.hasApiKey(config.model.provider),
      tools: config.tools.enabled.map((name) => ({
        name,
        requiresApproval: policy.protects(name),
      })),
      permissionGrants: await policy.listGrants(),
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.PERMISSION_GRANT_DELETE,
    async (event, request: DeletePermissionGrantRequest): Promise<void> => {
      assertTrustedSender(event)
      await policy.revoke(request.id)
    },
  )
  window.once('closed', () => {
    ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_GET)
    ipcMain.removeHandler(IPC_CHANNELS.PERMISSION_GRANT_DELETE)
  })
}
