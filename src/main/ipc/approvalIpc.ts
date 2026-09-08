import { ipcMain, type BrowserWindow } from 'electron'

import type { ApprovalService } from '../approval/approvalService'

import type { ApprovalResponse } from '../../shared/approval/approvalTypes'

import { IPC_CHANNELS } from '@/shared/ipc/channels'

export function registerApprovalIpc(window: BrowserWindow, approvalService: ApprovalService) {
  const unsubscribe = approvalService.subscribe((request) => {
    if (window.isDestroyed()) {
      return
    }

    window.webContents.send(IPC_CHANNELS.APPROVAL_REQUEST, request)
  })

  ipcMain.on(
    IPC_CHANNELS.APPROVAL_RESPOND,

    (_event, response: ApprovalResponse) => {
      approvalService.respond(response)
    },
  )

  return () => {
    unsubscribe()
    ipcMain.removeAllListeners(IPC_CHANNELS.APPROVAL_RESPOND)
  }
}
