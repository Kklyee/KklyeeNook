import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import { DrizzleAgentRunRepo } from './repositories/agentRunRepo'
import { DrizzleArtifactRepo } from './repositories/artifactRepo'
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
      artifactIds: ['artifact-1'],
    })
    const artifactRepo = new DrizzleArtifactRepo(database)
    await artifactRepo.save({
      id: 'artifact-1',
      sessionId: 'session-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      kind: 'code',
      title: 'Example',
      content: 'const x = 1',
      language: 'ts',
      metadata: { source: 'test' },
      createdAt: 2,
    })
    await expect(artifactRepo.findByRunId('run-1')).resolves.toMatchObject([
      { id: 'artifact-1', kind: 'code', metadata: { source: 'test' }, content: 'const x = 1' },
    ])
  } finally {
    await close()
  }
})
