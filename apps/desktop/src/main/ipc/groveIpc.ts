import { ipcMain, type BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@kklyeenook/shared/ipc/channels'
import type { GroveConnectRequest } from '@kklyeenook/shared/bot/grove-settings'
import type { SocialGrant } from '@kklyeenook/shared/bot/social'
import type { GroveConnection } from '../grove/connection'

export function registerGroveIpc(window: BrowserWindow, grove: GroveConnection) {
  const handlers = {
    [IPC_CHANNELS.GROVE_STATUS]: () => grove.status(),
    [IPC_CHANNELS.GROVE_CONFIGURE]: (input: GroveConnectRequest) => grove.configure(input),
    [IPC_CHANNELS.GROVE_CONNECTIONS]: () => grove.account().connections(),
    [IPC_CHANNELS.GROVE_INVITE]: (recipientUserId: string) =>
      grove.account().invite(recipientUserId),
    [IPC_CHANNELS.GROVE_DECIDE]: (input: {
      id: string
      state: 'accepted' | 'rejected' | 'revoked'
    }) => grove.account().decide(input.id, input.state),
    [IPC_CHANNELS.GROVE_GRANT]: (input: Omit<SocialGrant, 'id' | 'issuerUserId' | 'revokedAt'>) =>
      grove.account().grant(input),
    [IPC_CHANNELS.GROVE_REVOKE]: (id: string) => grove.account().revoke(id),
  }
  for (const [channel, handler] of Object.entries(handlers))
    ipcMain.handle(channel, async (event, input) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        throw new Error('Untrusted Grove sender')
      return handler(input)
    })
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
  }
}
