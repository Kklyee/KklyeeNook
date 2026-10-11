import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import { DrizzleAgentSessionRepo } from './repositories/agentSessionRepo'
import { connectDatabase } from './client'

test('applies pending migrations before repositories access the database', async () => {
  const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url))

  const { database, close } = await connectDatabase('file::memory:', migrationsFolder)

  try {

    const sessionRepo = new DrizzleAgentSessionRepo(database)
    await sessionRepo.save({
      id: 'session-1',
      title: 'Test',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    })
    await expect(sessionRepo.findById('session-1')).resolves.toMatchObject({ id: 'session-1', title: 'Test' })
  } finally {
    await close()
  }
})
