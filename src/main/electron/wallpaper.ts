import { app, dialog, nativeImage, type BrowserWindow } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function wallpaperPath(): string {
  return join(app.getPath('userData'), 'wallpaper.png')
}

export async function getWallpaper(): Promise<string | null> {
  try {
    const image = await readFile(wallpaperPath())
    return `data:image/png;base64,${image.toString('base64')}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function chooseWallpaper(window: BrowserWindow): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: '选择应用壁纸',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (canceled) return getWallpaper()
  let image = nativeImage.createFromPath(filePaths[0])
  if (image.isEmpty()) throw new Error('无法读取这张图片，请选择 PNG、JPG 或 WebP 图片。')
  const { width, height } = image.getSize()
  if (Math.max(width, height) > 2560) {
    image = image.resize(width >= height ? { width: 2560 } : { height: 2560 })
  }
  await writeFile(wallpaperPath(), image.toPNG())
  return getWallpaper()
}

export async function clearWallpaper(): Promise<null> {
  await rm(wallpaperPath(), { force: true })
  return null
}
