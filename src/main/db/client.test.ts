import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import { DrizzleAgentRunRepo } from './repositories/agentRunRepo'
import { DrizzleAgentSessionRepo } from './repositories/agentSessionRepo'
import { connectDatabase } from './client'

test('applies pending migrations before repositories access the database', async () => {
  const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url))

  const { database, close } = await connectDatabase('file::memory:', migrationsFolder)

  try {
    const runRepo = new DrizzleAgentRunRepo(database)
    await expect(runRepo.markActiveAsInterrupted(Date.now())).resolves.toBeUndefined()

    const sessionRepo = new DrizzleAgentSessionRepo(database)
    await sessionRepo.save({
      id: 'session-1',
      title: 'Test',
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    })
    await runRepo.save({
      id: 'run-1',
      sessionId: 'session-1',
      status: 'completed',
      createdAt: 1,
      updatedAt: 1,
      toolCalls: [],
      toolResults: [],
    })
    await expect(runRepo.findBySessionId('session-1')).resolves.toMatchObject([{ id: 'run-1' }])
  } finally {
    await close()
  }
})
