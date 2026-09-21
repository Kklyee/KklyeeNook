import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { ipcMain, BrowserWindow } from 'electron'

export function registerWindowIpc(window: BrowserWindow): () => void {
  const getSenderWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    return BrowserWindow.fromWebContents(event.sender) === window ? window : null
  }
  const sendMaximizedState = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED, window.isMaximized())
    }
  }
  const handleMinimize = (event: Electron.IpcMainEvent) => {
    getSenderWindow(event)?.minimize()
  }
  const handleToggleMaximize = (event: Electron.IpcMainEvent) => {
    const senderWindow = getSenderWindow(event)
    if (!senderWindow) return
    if (senderWindow.isMaximized()) {
      senderWindow.unmaximize()
    } else {
      senderWindow.maximize()
    }
  }
  const handleIsMaximized = (event: Electron.IpcMainInvokeEvent) => {
    return getSenderWindow(event)?.isMaximized() ?? false
  }
  const handleClose = (event: Electron.IpcMainEvent) => {
    getSenderWindow(event)?.close()
  }

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, handleMinimize)
  ipcMain.on(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, handleToggleMaximize)
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, handleIsMaximized)
  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, handleClose)
  window.on('maximize', sendMaximizedState)
  window.on('unmaximize', sendMaximizedState)

  return () => {
    ipcMain.removeListener(IPC_CHANNELS.WINDOW_MINIMIZE, handleMinimize)
    ipcMain.removeListener(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, handleToggleMaximize)
    ipcMain.removeHandler(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
    ipcMain.removeListener(IPC_CHANNELS.WINDOW_CLOSE, handleClose)
    window.removeListener('maximize', sendMaximizedState)
    window.removeListener('unmaximize', sendMaximizedState)
  }
}
