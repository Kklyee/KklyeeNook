import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { connectDatabase } from '../db/client'
import { DrizzleWorkspaceRepo } from '../db/repositories/workspaceRepo'
import { DrizzleAgentSessionRepo } from '../db/repositories/agentSessionRepo'
import { WorkspaceService } from './workspaceService'

test('reattaches renamed directories with their original identity and detects missing directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-workspace-'))
  const { database, close } = await connectDatabase('file::memory:', fileURLToPath(new URL('../../../drizzle', import.meta.url)))
  try {
    const service = new WorkspaceService(new DrizzleWorkspaceRepo(database))
    const original = join(root, 'KklyeeNook')
    await mkdir(original)
    const first = (await service.attach(original)).workspace!
    expect((await service.attach(original)).workspace?.id).toBe(first.id)
    const sessions = new DrizzleAgentSessionRepo(database)
    for (let i = 0; i < 3; i++) await sessions.save({ id: String(i), title: 'Conversation', workspaceId: first.id, archived: false, createdAt: 1, updatedAt: 1 })
    await service.detach(first.id)
    expect((await sessions.findAll()).map(item => item.workspaceId)).toEqual([first.id, first.id, first.id])
    expect(await service.resolve(first.id)).toMatchObject({ status: 'detached', lastKnownPath: first.rootPath })
    expect((await service.resolve(first.id)).rootPath).toBeUndefined()
    const moved = join(root, 'MyAgent')
    await rename(original, moved)
    expect((await service.attach(moved)).workspace).toMatchObject({ id: first.id, displayName: 'MyAgent', status: 'attached' })
    await rm(moved, { recursive: true })
    expect(await service.resolve(first.id)).toMatchObject({ status: 'missing' })
    const clone = join(root, 'Clone')
    await mkdir(clone)
    const pending = await service.attach(clone)
    expect(pending.candidates?.map(item => item.id)).toContain(first.id)
    expect((await service.attach(clone, { relinkId: first.id })).workspace?.id).toBe(first.id)
  } finally {
    close()
    await rm(root, { recursive: true, force: true })
  }
})
