import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import { connectDatabase } from '../client'
import { DrizzleAgentMemoryRepo } from './memoryRepo'

test('persists memories and filters workspace scope', async () => {
  const migrationsFolder = fileURLToPath(new URL('../../../../drizzle', import.meta.url))
  const { database, close } = await connectDatabase('file::memory:', migrationsFolder)

  try {
    const repo = new DrizzleAgentMemoryRepo(database)
    const globalMemory = await repo.create({ scope: 'global', content: 'Use pnpm' })
    const workspaceMemory = await repo.create({
      scope: 'workspace',
      content: 'Use strict TypeScript',
      workspacePath: 'C:/workspace-a',
    })
    await repo.create({ scope: 'workspace', content: 'Use npm', workspacePath: 'C:/workspace-b' })

    await expect(repo.list('C:/workspace-a')).resolves.toEqual([workspaceMemory, globalMemory])
    await expect(repo.list('C:/workspace-b')).resolves.toEqual([
      expect.objectContaining({ content: 'Use npm', scope: 'workspace' }),
      globalMemory,
    ])

    const updated = await repo.update(globalMemory.id, 'Use pnpm with frozen lockfile')
    expect(updated).toMatchObject({ id: globalMemory.id, content: 'Use pnpm with frozen lockfile' })

    await repo.delete(workspaceMemory.id)
    await expect(repo.list('C:/workspace-a')).resolves.toEqual([
      expect.objectContaining({ id: globalMemory.id, content: 'Use pnpm with frozen lockfile' }),
    ])
  } finally {
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
      'Workspace memory requires a workspace path',
    )
  } finally {
    close()
  }
})
