import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { ipcMain, BrowserWindow, Menu } from 'electron'
import type { WindowMenu, WindowMenuAction } from '@/shared/ipc/channels'

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
  const handleShowMenu = (
    event: Electron.IpcMainEvent,
    menuName: WindowMenu,
    x: number,
    y: number,
  ) => {
    const senderWindow = getSenderWindow(event)
    if (!senderWindow) return

    const menu =
      menuName === 'application'
        ? Menu.buildFromTemplate([
            {
              label: '设置',
              accelerator: 'CommandOrControl+,',
              click: () => {
                senderWindow.webContents.send(
                  IPC_CHANNELS.WINDOW_MENU_ACTION,
                  'settings' satisfies WindowMenuAction,
                )
              },
            },
            { type: 'separator' },
            { label: '退出应用', role: 'quit' },
          ])
        : Menu.buildFromTemplate([
            { label: '撤销', role: 'undo' },
            { label: '重做', role: 'redo' },
            { type: 'separator' },
            { label: '剪切', role: 'cut' },
            { label: '复制', role: 'copy' },
            { label: '粘贴', role: 'paste' },
            { label: '删除', role: 'delete' },
            { type: 'separator' },
            { label: '全选', role: 'selectAll' },
          ])

    menu.popup({ window: senderWindow, x, y })
  }

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, handleMinimize)
  ipcMain.on(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, handleToggleMaximize)
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, handleIsMaximized)
  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, handleClose)
  ipcMain.on(IPC_CHANNELS.WINDOW_MENU_SHOW, handleShowMenu)
  window.on('maximize', sendMaximizedState)
  window.on('unmaximize', sendMaximizedState)

  return () => {
    ipcMain.removeListener(IPC_CHANNELS.WINDOW_MINIMIZE, handleMinimize)
    ipcMain.removeListener(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, handleToggleMaximize)
    ipcMain.removeHandler(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
    ipcMain.removeListener(IPC_CHANNELS.WINDOW_CLOSE, handleClose)
    ipcMain.removeListener(IPC_CHANNELS.WINDOW_MENU_SHOW, handleShowMenu)
    window.removeListener('maximize', sendMaximizedState)
    window.removeListener('unmaximize', sendMaximizedState)
  }
}
