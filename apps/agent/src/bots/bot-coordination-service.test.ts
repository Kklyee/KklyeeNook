import { expect, test, vi } from 'vitest'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { AgentHost } from '../runtime/agent-host'
import type { GroveRepo } from '../db/repositories/grove-repo'
import { BotCoordinationService } from './bot-coordination-service'

function fixture(archived: boolean) {
  const tasks = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), status: 'completed', updatedAt: 1, fromBotId: 'from', toBotId: 'to' }))
  const state = { workers: archived ? {} : Object.fromEntries(tasks.map((task) => [task.id, 1])), requests: {}, mentions: {} }
  const commit = vi.fn(async (action: (tx: unknown) => unknown) => action({ doc: async () => state }))
  const host = { engine: { harness: { commit, snapshot: async () => state } } } as unknown as AgentHost
  const repo = { tasks: async () => tasks, putMessage: async () => {} } as unknown as GroveRepo
  return { service: new BotCoordinationService(repo), host, commit }
}

test('reopening already archived collaboration history does not commit once per task', async () => {
  const { service, host, commit } = fixture(true)
  await service.connect(host, BACKGROUND_CONTEXT)
  expect(commit).toHaveBeenCalledTimes(1)
})

test('startup batches existing terminal worker cleanup into one commit', async () => {
  const { service, host, commit } = fixture(false)
  await service.connect(host, BACKGROUND_CONTEXT)
  expect(commit).toHaveBeenCalledTimes(2)
})
