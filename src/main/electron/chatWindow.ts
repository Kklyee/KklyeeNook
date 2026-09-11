import { BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const preloadPath = path.join(__dirname, '../preload/index.js')

// Menu.setApplicationMenu(null)

export function createChatWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 560,
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: false },
  })
}
