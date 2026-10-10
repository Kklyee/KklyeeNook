import { expect, test, vi } from 'vitest'
import { Agent } from '@earendil-works/pi-agent-core'
import { AgentSession } from '@earendil-works/pi-coding-agent'
import { createAssistantMessageEventStream, type AssistantMessage } from 'pi-ai-legacy'

function createSession(
  agent = new Agent({
    streamFn: () => {
      throw new Error('Unexpected inference')
    },
  }),
) {
  const updates: Array<{ steering: string[]; followUp: string[] }> = []
  const session: AgentSession = Object.assign(Object.create(AgentSession.prototype), {
    agent,
    _steeringMessages: [],
    _followUpMessages: [],
    _resourceLoader: { getPrompts: () => ({ prompts: [] }) },
    _eventListeners: [(event: { steering: string[]; followUp: string[] }) => updates.push(event)],
  })
  return { session, agent, updates }
}

test('edits, removes and reorders native follow-ups without touching the transcript or attachments', async () => {
  let release: () => void = () => undefined
  let requests = 0
  const agent = new Agent({
    streamFn: () => {
      const stream = createAssistantMessageEventStream()
      const message: AssistantMessage = {
        role: 'assistant',
        api: 'openai-completions',
        provider: 'test',
        model: 'test',
        timestamp: Date.now(),
        content: [{ type: 'text', text: `reply ${++requests}` }],
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
      const finish = () => {
        stream.push({ type: 'start', partial: message })
        stream.push({ type: 'done', reason: 'stop', message })
      }
      if (requests === 1) release = finish
      else finish()
      return stream
    },
  })
  const { session, updates } = createSession(agent)
  const completion = agent.prompt('initial')
  const image = { type: 'image' as const, data: 'base64', mimeType: 'image/png' }
  await session.followUp('first', [image])
  await session.followUp('remove me')
  await session.followUp('last')
  session.updateQueuedMessage('followUp', ['first', 'remove me', 'last'], 0, 'edit', 'edited')
  session.updateQueuedMessage('followUp', ['edited', 'remove me', 'last'], 1, 'remove')
  session.updateQueuedMessage('followUp', ['edited', 'last'], 1, 'move', 0)
  session.updateQueuedMessage('followUp', ['last', 'edited'], 0, 'move', 1)
  session.updateQueuedMessage('followUp', ['edited', 'last'], 1, 'move', 0)
  expect(session.getFollowUpMessages()).toEqual(['last', 'edited'])
  expect(updates.at(-1)).toEqual({
    type: 'queue_update',
    steering: [],
    followUp: ['last', 'edited'],
  })
  expect(agent.state.messages).toHaveLength(1)
  expect(requests).toBe(1)
  release()
  await completion
  expect(agent.state.messages.map((message) => message.role)).toEqual([
    'user',
    'assistant',
    'user',
    'assistant',
    'user',
    'assistant',
  ])
  const users = agent.state.messages.filter((message) => message.role === 'user')
  expect(users.map((message) => message.content)).toEqual([
    [{ type: 'text', text: 'initial' }],
    [{ type: 'text', text: 'last' }],
    [{ type: 'text', text: 'edited' }, image],
  ])
})

test('rejects stale edits and keeps duplicate messages and queue lanes independent', async () => {
  const { session, agent } = createSession()
  await session.followUp('same')
  await session.followUp('same')
  await session.steer('now')
  expect(() => session.updateQueuedMessage('followUp', ['same'], 0, 'remove')).toThrow(
    'Queue changed',
  )
  expect(() => session.updateQueuedMessage('followUp', ['same', 'same'], 0, 'edit', ' ')).toThrow(
    'cannot be empty',
  )
  session.updateQueuedMessage('followUp', ['same', 'same'], 1, 'edit', 'second')
  session.updateQueuedMessage('steer', ['now'], 0, 'remove')
  expect(session.getFollowUpMessages()).toEqual(['same', 'second'])
  expect(session.clearQueue()).toEqual({ steering: [], followUp: ['same', 'second'] })
  expect(agent.hasQueuedMessages()).toBe(false)
  expect(session.getFollowUpMessages()).toEqual([])
})

test('steers the selected follow-up atomically and preserves attachments and other queued messages', async () => {
  const { session, agent, updates } = createSession()
  const image = { type: 'image' as const, data: 'base64', mimeType: 'image/png' }
  await session.steer('existing steer')
  await session.followUp('same')
  await session.followUp('same', [image])
  await session.followUp('last')
  const steer = vi.spyOn(agent, 'steer')
  expect(session.updateQueuedMessage('followUp', ['same', 'same', 'last'], 1, 'steer')).toEqual({
    steering: ['existing steer', 'same'],
    followUp: ['same', 'last'],
  })
  expect(updates.at(-1)).toEqual({
    type: 'queue_update',
    steering: ['existing steer', 'same'],
    followUp: ['same', 'last'],
  })
  const nativeQueue = agent as unknown as {
    steeringQueue: { messages: Array<{ content: unknown[] }> }
    followUpQueue: { messages: Array<{ content: unknown[] }> }
  }
  expect(nativeQueue.steeringQueue.messages[1].content).toEqual([{ type: 'text', text: 'same' }, image])
  expect(steer).toHaveBeenCalledWith(nativeQueue.steeringQueue.messages[1])
  expect(nativeQueue.followUpQueue.messages.map((message) => message.content)).toEqual([
    [{ type: 'text', text: 'same' }],
    [{ type: 'text', text: 'last' }],
  ])
  expect(() => session.updateQueuedMessage('steer', ['existing steer', 'same'], 0, 'steer')).toThrow('Invalid queue action')
  expect(() => session.updateQueuedMessage('followUp', ['same', 'same', 'last'], 1, 'steer')).toThrow('Queue changed')
  session.updateQueuedMessage('steer', ['existing steer', 'same'], 1, 'remove')
  expect(nativeQueue.steeringQueue.messages).toHaveLength(1)
  expect(session.getSteeringMessages()).toEqual(['existing steer'])
})
