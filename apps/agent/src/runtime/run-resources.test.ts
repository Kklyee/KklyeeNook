import { expect, test, vi } from 'vitest'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { LiveDoc } from '@earendil-works/pi-durable'
import type { AgentEngine } from './agent-engine'
import { RunResources } from './run-resources'

test('shutdown attempts every watch, engine and sandbox cleanup when individual releases fail', async () => {
  const stops = [vi.fn(async () => { throw new Error('Watch failed') }), vi.fn(async () => {})]
  const engine = { harness: {
    snapshot: vi.fn(async (doc, id) => doc === LiveDoc ? { run: { inputs: [id] } } : { runs: { first: { conversationId: 1, inputId: 1 }, second: { conversationId: 2, inputId: 2 } } }),
    watchDoc: vi.fn(async (_doc, id) => ({ stop: stops[id - 1], start: vi.fn(), closed: new Promise(() => {}) })),
  } } as unknown as AgentEngine
  const finishRun = vi.fn(async (id: string) => { if (id === 'first') throw new Error('Sandbox failed') })
  const shutdown = vi.fn(async () => { throw new Error('Engine failed') })
  const resources = new RunResources({ finishRun })
  await resources.connect(engine, BACKGROUND_CONTEXT)
  await expect(resources.close(shutdown)).rejects.toThrow()
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true)
  expect(shutdown).toHaveBeenCalledTimes(1)
  expect(finishRun.mock.calls.map(([id]) => id).sort()).toEqual(['first', 'second'])
  await expect(resources.close(shutdown)).rejects.toThrow()
  expect(shutdown).toHaveBeenCalledTimes(1)
})
