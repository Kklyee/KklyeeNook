import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import { DrizzleAgentRunRepo } from './repo/agentRunRepo'
import { connectDatabase } from './client'

test('applies pending migrations before repositories access the database', async () => {
  const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url))

  const { database, close } = await connectDatabase('file::memory:', migrationsFolder)

  try {
    const runRepo = new DrizzleAgentRunRepo(database)
    await expect(runRepo.markActiveAsInterrupted(Date.now())).resolves.toBeUndefined()
  } finally {
    await close()
  }
})
