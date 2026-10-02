import { isUtf8 } from 'node:buffer'
import { open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { AgentExecutionContext } from '@/shared/workspace/workspace'
import type {
  PreviewWorkspaceFileRequest,
  WorkspaceFilePreview,
} from '@/shared/preview/workspacePreview'

const TEXT_LIMIT = 2 * 1024 * 1024
const IMAGE_LIMIT = 10 * 1024 * 1024
const imageTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}
const textTypes: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
}
const binaryExtensions = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
  '.gz',
  '.7z',
  '.exe',
  '.dll',
  '.wasm',
  '.ico',
  '.mp3',
  '.mp4',
  '.woff',
  '.woff2',
  '.ttf',
  '.db',
])

function verifyInside(root: string, path: string): void {
  const resolved = relative(root, path)
  if (resolved === '..' || resolved.startsWith(`..${sep}`) || isAbsolute(resolved)) {
    throw new Error('无法预览工作区外的文件')
  }
}

function isMissing(error: unknown): boolean {
  return (
    (error as NodeJS.ErrnoException).code === 'ENOENT' ||
    (error as NodeJS.ErrnoException).code === 'ENOTDIR'
  )
}

export class WorkspacePreviewService {
  constructor(private readonly getContext: (sessionId: string) => Promise<AgentExecutionContext>) {}

  async readWorkspaceFile(request: PreviewWorkspaceFileRequest): Promise<WorkspaceFilePreview> {
    const context = await this.getContext(request.sessionId)
    if (!context.workspace) throw new Error('会话工作区不可用')
    let root: string
    try {
      root = await realpath(context.workspace.rootPath)
      if (!(await stat(root)).isDirectory()) throw new Error('会话工作区不可用')
    } catch {
      throw new Error('会话工作区不可用')
    }
    const path = resolve(root, request.path)
    verifyInside(root, path)
    let canonical: string
    try {
      canonical = await realpath(path)
    } catch (error) {
      if (!isMissing(error)) throw error
      let ancestor = dirname(path)
      while (true) {
        try {
          verifyInside(root, await realpath(ancestor))
          break
        } catch (ancestorError) {
          if (!isMissing(ancestorError)) throw ancestorError
          ancestor = dirname(ancestor)
        }
      }
      return { kind: 'missing', path, filename: basename(path) }
    }
    verifyInside(root, canonical)
    const file = await open(canonical, 'r').catch((error) => {
      if (isMissing(error)) return undefined
      throw error
    })
    if (!file) return { kind: 'missing', path, filename: basename(path) }
    try {
      const info = await file.stat()
      const openedPath = await realpath(canonical)
      verifyInside(root, openedPath)
      const currentFile = await stat(openedPath)
      if (info.dev !== currentFile.dev || info.ino !== currentFile.ino) {
        throw new Error('文件正在修改，请重新打开预览')
      }
      const metadata = { path, filename: basename(path), size: info.size }
      const extension = extname(path).toLowerCase()
      const imageType = imageTypes[extension]
      const mimeType = imageType ?? textTypes[extension] ?? 'text/plain'
      if (!info.isFile() || binaryExtensions.has(extension)) {
        return { ...metadata, kind: 'unsupported', reason: 'format' }
      }
      const limit = imageType ? IMAGE_LIMIT : TEXT_LIMIT
      if (info.size > limit) {
        return { ...metadata, kind: 'unsupported', mimeType, reason: 'too-large' }
      }
      const buffer = Buffer.alloc(Math.min(info.size + 1, limit + 1))
      let bytesRead = 0
      while (bytesRead < buffer.length) {
        const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, null)
        if (!chunk.bytesRead) break
        bytesRead += chunk.bytesRead
      }
      const currentSize = (await file.stat()).size
      if (currentSize > limit || bytesRead > info.size) {
        if (currentSize > limit) {
          return {
            ...metadata,
            size: currentSize,
            kind: 'unsupported',
            mimeType,
            reason: 'too-large',
          }
        }
        throw new Error('文件正在修改，请重新打开预览')
      }
      const data = buffer.subarray(0, bytesRead)
      metadata.size = bytesRead
      if (imageType)
        return { ...metadata, kind: 'image', mimeType, base64: data.toString('base64') }
      if (data.includes(0) || !isUtf8(data)) {
        return { ...metadata, kind: 'unsupported', reason: 'format' }
      }
      return { ...metadata, kind: 'text', mimeType, content: data.toString('utf8') }
    } catch (error) {
      if (isMissing(error)) return { kind: 'missing', path, filename: basename(path) }
      throw error
    } finally {
      await file.close()
    }
  }
}
