import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import { connectDatabase } from '../client'
import { DrizzleScheduledTaskRepo } from './scheduledTaskRepo'

test('persists and queries scheduled tasks through SQLite', async () => {
  const migrationsFolder = fileURLToPath(new URL('../../../../drizzle', import.meta.url))
  const { database, close } = await connectDatabase('file::memory:', migrationsFolder)

  try {
    const repo = new DrizzleScheduledTaskRepo(database)
    const task = {
      id: 'task-1',
      title: 'Daily project check',
      prompt: 'Check the project',
      schedule: { type: 'daily' as const, time: '09:00' },
      enabled: true,
      nextRunAt: 100,
      createdAt: 1,
      updatedAt: 1,
    }

    await repo.save(task)
    await expect(repo.findAll()).resolves.toMatchObject([task])
    await expect(repo.findEnabled()).resolves.toMatchObject([task])

    await repo.save({ ...task, enabled: false, nextRunAt: undefined, updatedAt: 2 })
    await expect(repo.findEnabled()).resolves.toEqual([])

    await repo.delete(task.id)
    await expect(repo.findById(task.id)).resolves.toBeUndefined()
  } finally {
    await close()
  }
})
