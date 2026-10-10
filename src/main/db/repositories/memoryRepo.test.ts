import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vitest'

import { connectDatabase } from '../client'
import { DrizzleAgentMemoryRepo } from './memoryRepo'

test('persists memories and filters workspace scope', async () => {
  const migrationsFolder = fileURLToPath(new URL('../../../../drizzle', import.meta.url))
  const { database, close } = await connectDatabase('file::memory:', migrationsFolder)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)

  try {
    await database.$client.execute("INSERT INTO workspaces (id, display_name, status, created_at, updated_at) VALUES ('C:/workspace-a', 'A', 'detached', 1, 1), ('C:/workspace-b', 'B', 'detached', 1, 1)")
    const repo = new DrizzleAgentMemoryRepo(database)
    const globalMemory = await repo.create({ scope: 'global', content: 'Use pnpm' })
    clock.mockReturnValue(2000)
    const workspaceMemory = await repo.create({
      scope: 'workspace',
      content: 'Use strict TypeScript',
      workspaceId: 'C:/workspace-a',
    })
    clock.mockReturnValue(3000)
    await repo.create({ scope: 'workspace', content: 'Use npm', workspaceId: 'C:/workspace-b' })

    await expect(repo.list('C:/workspace-a')).resolves.toEqual([workspaceMemory, globalMemory])
    await expect(repo.list('C:/workspace-b')).resolves.toEqual([
      expect.objectContaining({ content: 'Use npm', scope: 'workspace' }),
      globalMemory,
    ])

    clock.mockReturnValue(4000)
    const updated = await repo.update(globalMemory.id, 'Use pnpm with frozen lockfile')
    expect(updated).toMatchObject({ id: globalMemory.id, content: 'Use pnpm with frozen lockfile' })

    await repo.delete(workspaceMemory.id)
    await expect(repo.list('C:/workspace-a')).resolves.toEqual([
      expect.objectContaining({ id: globalMemory.id, content: 'Use pnpm with frozen lockfile' }),
    ])
  } finally {
    clock.mockRestore()
    close()
  }
})

test('rejects empty content and workspace memories without a workspace', async () => {
  const migrationsFolder = fileURLToPath(new URL('../../../../drizzle', import.meta.url))
  const { database, close } = await connectDatabase('file::memory:', migrationsFolder)

  try {
    const repo = new DrizzleAgentMemoryRepo(database)
    await expect(repo.create({ scope: 'global', content: '  ' })).rejects.toThrow(
      'Memory content is required',
    )
    await expect(repo.create({ scope: 'workspace', content: 'fact' })).rejects.toThrow(
      'Workspace memory requires a workspace ID',
    )
  } finally {
    close()
  }
})
