import { BrowserWindow, Menu, nativeTheme } from 'electron'
import { release } from 'node:os'
import type { SystemMaterial } from '@/shared/platform/systemMaterial'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const preloadPath = path.join(__dirname, '../preload/index.js')
const materials = new WeakMap<BrowserWindow, SystemMaterial>()

export function getSystemMaterial(window: BrowserWindow): SystemMaterial {
  return materials.get(window) ?? 'solid'
}

function resolveSystemMaterial(): SystemMaterial {
  if (nativeTheme.prefersReducedTransparency || nativeTheme.shouldUseHighContrastColors) return 'solid'
  if (process.platform === 'win32') {
    const [major, , build] = release().split('.').map(Number)
    return major >= 10 && build >= 22621 && typeof BrowserWindow.prototype.setBackgroundMaterial === 'function'
      ? 'acrylic'
      : 'solid'
  }
  if (process.platform === 'darwin' && typeof BrowserWindow.prototype.setVibrancy === 'function') return 'vibrancy'
  return 'solid'
}

function solidBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1d1e' : '#f6f7f8'
}

export function createChatWindow(): BrowserWindow {
  Menu.setApplicationMenu(null)

  let material = resolveSystemMaterial()
  const options: Electron.BrowserWindowConstructorOptions = {
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 560,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: material === 'solid' ? solidBackground() : '#00000000',
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: false },
  }
  if (material === 'acrylic') options.backgroundMaterial = 'acrylic'
  if (material === 'vibrancy') {
    options.vibrancy = 'under-window'
    options.visualEffectState = 'followWindow'
  }

  let window: BrowserWindow
  try {
    window = new BrowserWindow(options)
  } catch (error) {
    if (material === 'solid') throw error
    console.debug('system-material: unavailable, using solid fallback', error)
    material = 'solid'
    delete options.backgroundMaterial
    delete options.vibrancy
    delete options.visualEffectState
    options.backgroundColor = solidBackground()
    window = new BrowserWindow(options)
  }
  try {
    if (material === 'acrylic') window.setBackgroundMaterial('acrylic')
    if (material === 'vibrancy') window.setVibrancy('under-window')
  } catch (error) {
    material = 'solid'
    window.setBackgroundColor(solidBackground())
    console.debug('system-material: unavailable, using solid fallback', error)
  }
  materials.set(window, material)
  console.debug(`system-material: ${material} enabled`)

  const updateMaterial = () => {
    let next = resolveSystemMaterial()
    try {
      if (process.platform === 'win32' && typeof window.setBackgroundMaterial === 'function') {
        window.setBackgroundMaterial(next === 'acrylic' ? 'acrylic' : 'none')
      }
      if (process.platform === 'darwin' && typeof window.setVibrancy === 'function') {
        window.setVibrancy(next === 'vibrancy' ? 'under-window' : null)
      }
    } catch (error) {
      next = 'solid'
      console.debug('system-material: unavailable, using solid fallback', error)
    }
    window.setBackgroundColor(next === 'solid' ? solidBackground() : '#00000000')
    materials.set(window, next)
    window.webContents.send(IPC_CHANNELS.WINDOW_SYSTEM_MATERIAL_CHANGED, next)
  }
  nativeTheme.on('updated', updateMaterial)
  window.once('closed', () => nativeTheme.removeListener('updated', updateMaterial))
  return window
}
