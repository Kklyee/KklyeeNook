import { expect, test, vi } from 'vitest'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { SnapshotEvent, EntryRecord } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { AgentHost } from './agent-host'
import { RunProjection } from './run-projection'
import { emptySnapshot } from './projection'
import { deriveAgentActivities } from '@kklyeenook/shared/agent/deriveAgentActivities'
import { groupAgentActivities } from '@kklyeenook/shared/agent/groupAgentActivities'

vi.mock('@earendil-works/pi-durable', async (original) => ({
  ...(await original<typeof import('@earendil-works/pi-durable')>()),
  watchEvents: async (harness: { testSnapshot: SnapshotEvent }) => ({
    snapshot: harness.testSnapshot,
    stop: async () => {},
  }),
}))

function fixture() {
  const tasks = [
    {
      id: 1,
      conversationId: 1,
      kind: 'pi.generation',
      startedAt: 10,
      endedAt: 50,
      state: { status: 'terminal', outcome: { status: 'completed' } },
    },
    {
      id: 2,
      conversationId: 1,
      kind: 'pi.generation',
      startedAt: 100,
      state: { status: 'running', checkpoint: { phase: 'request' } },
    },
  ]
  const tx = {
    conversation: async () => ({ id: 1 }),
    task: async (id: number) => tasks.find((task) => task.id === id),
    scanTasks: async () => ({ items: tasks }),
    scanConversations: async () => ({ items: [] }),
  }
  const harness = {
    testSnapshot: emptySnapshot(),
    commit: async <T>(fn: (transaction: typeof tx) => Promise<T>) => fn(tx),
    snapshot: async () => ({ tasks: { '1': 1, '2': 2 } }),
    submission: async () => undefined,
  }
  const host = {
    engine: {
      harness,
      conversation: async () => ({ id: 1 }),
      ownerThread: async () => ({ conversationId: 1, threadId: 'thread' }),
    },
    conversations: { get: async () => ({}) },
  }
  const message: AssistantMessage = {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'custom',
    model: 'Deepseek-V4.1-Flash',
    timestamp: 100,
    content: [{ type: 'thinking', thinking: 'Reasoning before replying' }],
    stopReason: 'stop',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
  return { projection: new RunProjection(host as unknown as AgentHost), harness, tasks, message }
}

test('projects thinking while the provider is streaming before any assistant entry is saved', async () => {
  const { projection, harness, message } = fixture()
  harness.testSnapshot.generation = { attempt: 1, message }
  const records = await projection.records('2', BACKGROUND_CONTEXT)
  expect(deriveAgentActivities(records)).toMatchObject([
    { type: 'thinking', content: 'Reasoning before replying', status: 'running' },
  ])
  expect(
    (await projection.records('1', BACKGROUND_CONTEXT)).some(
      (record) => record.event.type === 'thinking_delta',
    ),
  ).toBe(false)
})

test('keeps the reasoning identity and placement when streaming text becomes committed history', async () => {
  const { projection, harness, tasks, message } = fixture()
  harness.testSnapshot.generation = { attempt: 1, message }
  const initial = deriveAgentActivities(await projection.records('2', BACKGROUND_CONTEXT))[0]
  message.content.push({ type: 'text', text: 'Answer' })
  const live = await projection.records('2', BACKGROUND_CONTEXT)
  expect(deriveAgentActivities(live)).toMatchObject([{ id: initial.id, status: 'completed' }])
  expect(groupAgentActivities(live, deriveAgentActivities(live))[0].textOffset).toBe(0)
  harness.testSnapshot.entries = [
    {
      id: 1 as EntryRecord['id'],
      conversationId: 1 as EntryRecord['conversationId'],
      kind: 'pi.assistant',
      byTaskId: 2 as EntryRecord['byTaskId'],
      model: [message],
    },
  ]
  harness.testSnapshot.generation = undefined
  tasks[1] = {
    id: 2,
    conversationId: 1,
    kind: 'pi.generation',
    startedAt: 100,
    endedAt: 200,
    state: { status: 'terminal', outcome: { status: 'completed' } },
  }
  const committed = await projection.records('2', BACKGROUND_CONTEXT)
  expect(committed.filter((record) => record.event.type === 'thinking_delta')).toHaveLength(1)
  expect(deriveAgentActivities(committed)[0].id).toBe(initial.id)
  expect(committed.at(-1)?.event.type).toBe('agent_completed')
})

test('does not present incomplete streamed tool arguments as an executing tool', async () => {
  const { projection, harness, message } = fixture()
  message.content.push({ type: 'toolCall', id: 'call', name: 'read', arguments: {} })
  harness.testSnapshot.generation = { attempt: 1, message }
  expect(
    (await projection.records('2', BACKGROUND_CONTEXT)).some(
      (record) => record.event.type === 'tool_started',
    ),
  ).toBe(false)
})
