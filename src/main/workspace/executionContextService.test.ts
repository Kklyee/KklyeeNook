import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { connectDatabase } from '../db/client'
import { DrizzleAgentSessionRepo } from '../db/repositories/agentSessionRepo'
import { DrizzleWorkspaceRepo } from '../db/repositories/workspaceRepo'
import { DrizzleAgentMemoryRepo } from '../db/repositories/memoryRepo'
import { WorkspaceService } from './workspaceService'
import { ExecutionContextService } from './executionContextService'

test('isolates execution contexts and memory by workspace ID across detach and rename', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-context-'))
  const { database, close } = await connectDatabase(
    'file::memory:',
    fileURLToPath(new URL('../../../drizzle', import.meta.url)),
  )
  try {
    const workspaces = new WorkspaceService(new DrizzleWorkspaceRepo(database))
    const sessions = new DrizzleAgentSessionRepo(database)
    const memories = new DrizzleAgentMemoryRepo(database)
    const contexts = new ExecutionContextService(sessions, workspaces)
    const aPath = join(directory, 'a')
    const bPath = join(directory, 'b')
    await mkdir(aPath)
    await mkdir(bPath)
    const a = (await workspaces.attach(aPath)).workspace!
    const b = (await workspaces.attach(bPath)).workspace!
    for (const [id, workspaceId] of [
      ['a', a.id],
      ['b', b.id],
      ['ungrouped', null],
    ])
      await sessions.save({
        id: id!,
        workspaceId,
        title: 'Chat',
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      })
    expect(await contexts.resolve('ungrouped')).toEqual({
      conversationId: 'ungrouped',
      mode: 'read-only',
    })
    expect((await contexts.resolve('a')).workspace).toEqual({ id: a.id, rootPath: a.rootPath })
    expect((await contexts.resolve('b')).workspace).toEqual({ id: b.id, rootPath: b.rootPath })
    await memories.create({ scope: 'global', content: 'global' })
    await memories.create({ scope: 'workspace', workspaceId: a.id, content: 'a only' })
    expect((await memories.list()).map((item) => item.content)).toEqual(['global'])
    expect((await memories.list(b.id)).map((item) => item.content)).toEqual(['global'])
    await workspaces.detach(a.id)
    expect(await contexts.resolve('a')).toEqual({
      conversationId: 'a',
      workspaceId: a.id,
      mode: 'read-only',
    })
    const moved = join(directory, 'renamed')
    await rename(aPath, moved)
    await workspaces.attach(moved)
    expect((await contexts.resolve('a')).workspace?.rootPath).toBe(moved)
    expect((await memories.list(a.id)).map((item) => item.content)).toContain('a only')
  } finally {
    close()
    await rm(directory, { recursive: true, force: true })
  }
})
