import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const mocks = vi.hoisted(() => ({
  directory: '',
  pick: vi.fn(),
  decode: vi.fn(),
  resize: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.directory },
  dialog: { showOpenDialog: mocks.pick },
  nativeImage: { createFromPath: mocks.decode },
}))
import { chooseWallpaper, clearWallpaper, getWallpaper } from './wallpaper'

const window = {} as BrowserWindow

describe('application wallpaper persistence', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.directory = await mkdtemp(join(tmpdir(), 'nook-wallpaper-'))
    mocks.pick.mockResolvedValue({ canceled: false, filePaths: ['chosen.png'] })
    const image = { isEmpty: () => false, getSize: () => ({ width: 1200, height: 800 }), toPNG: () => Buffer.from('image'), resize: mocks.resize }
    mocks.decode.mockReturnValue(image)
    mocks.resize.mockReturnValue(image)
  })
  afterEach(async () => { await rm(mocks.directory, { recursive: true, force: true }) })

  it('starts without a wallpaper and safely clears an empty preference', async () => {
    expect(await getWallpaper()).toBeNull()
    expect(await clearWallpaper()).toBeNull()
  })

  it('stores a local copy and reads it again for the next launch', async () => {
    expect(await chooseWallpaper(window)).toBe('data:image/png;base64,aW1hZ2U=')
    expect(await readFile(join(mocks.directory, 'wallpaper.png'), 'utf8')).toBe('image')
    expect(await getWallpaper()).toBe('data:image/png;base64,aW1hZ2U=')
    expect(await clearWallpaper()).toBeNull()
    expect(await getWallpaper()).toBeNull()
  })

  it('preserves the wallpaper when the picker is canceled', async () => {
    await writeFile(join(mocks.directory, 'wallpaper.png'), 'original')
    mocks.pick.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await chooseWallpaper(window)).toBe('data:image/png;base64,b3JpZ2luYWw=')
    expect(mocks.decode).not.toHaveBeenCalled()
  })

  it('preserves the saved wallpaper if the selected file cannot be decoded', async () => {
    await writeFile(join(mocks.directory, 'wallpaper.png'), 'original')
    mocks.decode.mockReturnValue({ isEmpty: () => true })
    await expect(chooseWallpaper(window)).rejects.toThrow('无法读取这张图片')
    expect(await getWallpaper()).toBe('data:image/png;base64,b3JpZ2luYWw=')
  })

  it('limits large wallpapers once during import', async () => {
    mocks.decode.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 6000, height: 4000 }), resize: mocks.resize })
    await chooseWallpaper(window)
    expect(mocks.resize).toHaveBeenCalledWith({ width: 2560 })
  })
})
