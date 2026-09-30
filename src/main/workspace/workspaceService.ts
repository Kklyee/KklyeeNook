import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Workspace, WorkspaceAttachResult } from '@/shared/workspace/workspace'
import type { WorkspaceRepo } from '../db/repositories/workspaceRepo'

export class WorkspaceService {
  constructor(private readonly repo: WorkspaceRepo) {}

  async list(): Promise<Workspace[]> {
    const result = await this.repo.list()
    for (const workspace of result) {
      if (workspace.status !== 'attached' || !workspace.rootPath) continue
      try {
        const info = await stat(workspace.rootPath, { bigint: true })
        if (!info.isDirectory() || (workspace.fsInode && (String(info.ino) !== workspace.fsInode || String(info.dev) !== workspace.fsDevice))) {
          throw new Error('Workspace directory changed')
        }
      } catch {
        workspace.status = 'missing'
        workspace.lastKnownPath = workspace.rootPath
        workspace.rootPath = undefined
        workspace.updatedAt = Date.now()
        await this.repo.save(workspace)
      }
    }
    return result
  }

  async attach(path: string, choice?: { relinkId?: string; createNew?: boolean }): Promise<WorkspaceAttachResult> {
    const rootPath = await realpath(path)
    const info = await stat(rootPath, { bigint: true })
    if (!info.isDirectory()) throw new Error('请选择项目目录')
    const fsDevice = String(info.dev)
    const fsInode = info.ino === 0n ? undefined : String(info.ino)
    const all = await this.list()
    const samePath = (a?: string) => a && (process.platform === 'win32' ? a.toLowerCase() === rootPath.toLowerCase() : a === rootPath)
    let existing = all.find((workspace) => samePath(workspace.rootPath ?? workspace.lastKnownPath))
      ?? all.find((workspace) => fsInode && workspace.fsDevice === fsDevice && workspace.fsInode === fsInode)
    if (choice?.relinkId) {
      if (existing && existing.id !== choice.relinkId) throw new Error('该目录已关联其他项目')
      existing = await this.require(choice.relinkId)
    }
    if (!existing && !choice?.createNew) {
      const candidates = all.filter((workspace) => workspace.status !== 'attached')
      if (candidates.length) return { path: rootPath, candidates }
    }
    const now = Date.now()
    const workspace: Workspace = {
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      displayName: basename(rootPath) || rootPath,
      status: 'attached',
      rootPath,
      lastKnownPath: rootPath,
      fsDevice,
      fsInode,
      updatedAt: now,
      lastOpenedAt: now,
    }
    await this.repo.save(workspace)
    return { workspace }
  }

  async detach(id: string): Promise<void> {
    const workspace = await this.require(id)
    await this.repo.save({ ...workspace, status: 'detached', rootPath: undefined, lastKnownPath: workspace.rootPath ?? workspace.lastKnownPath, updatedAt: Date.now() })
  }

  async resolve(id: string): Promise<Workspace> {
    const workspace = (await this.list()).find((item) => item.id === id)
    if (!workspace) throw new Error('项目不存在')
    return workspace
  }

  private async require(id: string): Promise<Workspace> {
    const workspace = await this.repo.get(id)
    if (!workspace) throw new Error('项目不存在')
    return workspace
  }
}
