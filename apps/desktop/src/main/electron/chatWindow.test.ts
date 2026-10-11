import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  release: vi.fn(() => '10.0.22631'),
  constructor: vi.fn(),
  backgroundMaterial: vi.fn(),
  vibrancy: vi.fn(),
  backgroundColor: vi.fn(),
  send: vi.fn(),
}))

vi.mock('node:os', () => ({ release: mocks.release }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class BrowserWindow extends EventEmitter {
    webContents = { send: mocks.send }
    constructor(options: unknown) {
      super()
      mocks.constructor(options)
    }
    setBackgroundMaterial = mocks.backgroundMaterial
    setVibrancy = mocks.vibrancy
    setBackgroundColor = mocks.backgroundColor
  }
  BrowserWindow.prototype.setBackgroundMaterial = mocks.backgroundMaterial
  BrowserWindow.prototype.setVibrancy = mocks.vibrancy
  return {
    BrowserWindow,
    Menu: { setApplicationMenu: vi.fn() },
    nativeTheme: Object.assign(new EventEmitter(), {
      prefersReducedTransparency: false,
      shouldUseHighContrastColors: false,
      shouldUseDarkColors: true,
    }),
  }
})

import { BrowserWindow, nativeTheme } from 'electron'
import { createChatWindow, getSystemMaterial, setSystemMaterialEnabled } from './chatWindow'

describe('system material window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.constructor.mockReset()
    mocks.backgroundMaterial.mockReset()
    mocks.release.mockReturnValue('10.0.22631')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    Object.assign(nativeTheme, {
      prefersReducedTransparency: false,
      shouldUseHighContrastColors: false,
      shouldUseDarkColors: true,
    })
    nativeTheme.removeAllListeners()
  })

  it('uses official acrylic without transparent windows', () => {
    const window = createChatWindow()
    expect(getSystemMaterial(window)).toBe('acrylic')
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({
      backgroundMaterial: 'acrylic', backgroundColor: '#00000000',
    }))
    expect(mocks.constructor.mock.calls[0][0]).not.toHaveProperty('transparent')
  })

  it('keeps material disabled through system theme changes and restores it on demand', () => {
    const window = createChatWindow()
    expect(setSystemMaterialEnabled(window, false)).toBe('solid')
    expect(mocks.backgroundMaterial).toHaveBeenLastCalledWith('none')
    nativeTheme.emit('updated')
    expect(getSystemMaterial(window)).toBe('solid')
    expect(setSystemMaterialEnabled(window, true)).toBe('acrylic')
    expect(mocks.backgroundMaterial).toHaveBeenLastCalledWith('acrylic')
  })

  it('keeps reduced transparency respected when re-enabling material', () => {
    const window = createChatWindow()
    setSystemMaterialEnabled(window, false)
    Object.assign(nativeTheme, { prefersReducedTransparency: true })
    expect(setSystemMaterialEnabled(window, true)).toBe('solid')
  })

  it('uses solid on Windows before 22H2', () => {
    mocks.release.mockReturnValue('10.0.22000')
    expect(getSystemMaterial(createChatWindow())).toBe('solid')
    expect(mocks.constructor.mock.calls[0][0]).not.toHaveProperty('backgroundMaterial')
  })

  it('uses solid when runtime material support is unavailable', () => {
    const method = BrowserWindow.prototype.setBackgroundMaterial
    Object.defineProperty(BrowserWindow.prototype, 'setBackgroundMaterial', { value: undefined, configurable: true })
    try {
      expect(getSystemMaterial(createChatWindow())).toBe('solid')
    } finally {
      Object.defineProperty(BrowserWindow.prototype, 'setBackgroundMaterial', { value: method, configurable: true })
    }
  })

  it('recreates a solid window when material construction fails', () => {
    mocks.constructor.mockImplementationOnce(() => { throw new Error('material unavailable') })
    expect(getSystemMaterial(createChatWindow())).toBe('solid')
    expect(mocks.constructor).toHaveBeenCalledTimes(2)
    expect(mocks.constructor.mock.calls[1][0]).not.toHaveProperty('backgroundMaterial')
    expect(mocks.constructor.mock.calls[1][0].backgroundColor).toBe('#1c1d1e')
  })

  it('uses solid when runtime material initialization fails', () => {
    mocks.backgroundMaterial.mockImplementationOnce(() => { throw new Error('material unavailable') })
    expect(getSystemMaterial(createChatWindow())).toBe('solid')
    expect(mocks.backgroundColor).toHaveBeenCalledWith('#1c1d1e')
  })

  it('uses one under-window vibrancy on macOS', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(getSystemMaterial(createChatWindow())).toBe('vibrancy')
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({
      vibrancy: 'under-window', visualEffectState: 'followWindow', backgroundColor: '#00000000',
    }))
  })

  it('uses solid on Linux', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(getSystemMaterial(createChatWindow())).toBe('solid')
  })

  it.each(['prefersReducedTransparency', 'shouldUseHighContrastColors'])(
    'respects %s at startup and after settings change', (preference) => {
      Object.assign(nativeTheme, { [preference]: true })
      const window = createChatWindow()
      expect(getSystemMaterial(window)).toBe('solid')
      Object.assign(nativeTheme, { [preference]: false })
      nativeTheme.emit('updated')
      expect(getSystemMaterial(window)).toBe('acrylic')
      Object.assign(nativeTheme, { [preference]: true, shouldUseDarkColors: false })
      nativeTheme.emit('updated')
      expect(getSystemMaterial(window)).toBe('solid')
      expect(mocks.backgroundMaterial).toHaveBeenLastCalledWith('none')
      expect(mocks.backgroundColor).toHaveBeenLastCalledWith('#f6f7f8')
      expect(mocks.send).toHaveBeenLastCalledWith('window:system-material-changed', 'solid')
      window.emit('closed')
      expect(nativeTheme.listenerCount('updated')).toBe(0)
    },
  )
})
