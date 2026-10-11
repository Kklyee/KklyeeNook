import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export interface ResolvedWorkspacePath {
  path: string
  inside: boolean
}

async function canonicalTarget(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      const entry = await lstat(path)
      if (entry.isSymbolicLink()) throw new Error('Cannot resolve dangling symlink')
    } catch (entryError) {
      if ((entryError as NodeJS.ErrnoException).code !== 'ENOENT') throw entryError
    }
    const parent = dirname(path)
    if (parent === path) throw error
    return resolve(await canonicalTarget(parent), relative(parent, path))
  }
}

export class WorkspacePathPolicy {
  async resolve(requested: string, workspaceRoot?: string): Promise<ResolvedWorkspacePath> {
    if (!requested.trim()) throw new Error('File path is required')
    if (
      process.platform === 'win32' &&
      (/^(\\\\[?.]\\)/.test(requested) || requested.slice(2).includes(':'))
    )
      throw new Error('Unsupported Windows path')
    const expanded =
      requested === '~'
        ? homedir()
        : /^~[\\/]/.test(requested)
          ? resolve(homedir(), requested.slice(2))
          : requested
    if (!workspaceRoot && !isAbsolute(expanded)) throw new Error('未关联项目时必须提供绝对路径')
    const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(workspaceRoot!, expanded)
    const path = await canonicalTarget(absolute)
    if (!workspaceRoot) return { path, inside: false }
    const root = await realpath(workspaceRoot)
    const expectedRoot = resolve(workspaceRoot)
    if (
      process.platform === 'win32'
        ? root.toLowerCase() !== expectedRoot.toLowerCase()
        : root !== expectedRoot
    )
      throw new Error('Workspace root changed; relink the project')
    const fromRoot = relative(root, path)
    const inside = fromRoot !== '..' && !fromRoot.startsWith('..' + sep) && !isAbsolute(fromRoot)
    return { path, inside }
  }
}
