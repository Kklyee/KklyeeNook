import type { PiClient, PiThreadSnapshot } from '@assistant-ui/react-pi'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingNewThreadPreferences,
  setPendingNewThreadPreferences,
  withPendingNewThreadPreferences,
} from './pendingNewThreadPreferences'

const snapshot: PiThreadSnapshot = {
  metadata: { id: 'thread-1', status: 'idle' },
  messages: [],
}

afterEach(() => {
  clearPendingNewThreadPreferences()
})

describe('pending new-thread preferences', () => {
  it('applies the selected model and thinking level before the first message', async () => {
    const calls: string[] = []
    const baseClient = {
      createThread: vi.fn(async () => {
        calls.push('create')
        return snapshot
      }),
      setModel: vi.fn(async (threadId, model) => {
        calls.push(`model:${threadId}:${model.provider}:${model.modelId}`)
      }),
      setThinkingLevel: vi.fn(async (threadId, level) => {
        calls.push(`thinking:${threadId}:${level}`)
      }),
      sendMessage: vi.fn(async (threadId) => {
        calls.push(`send:${threadId}`)
      }),
    } as unknown as PiClient
    const client = withPendingNewThreadPreferences(baseClient)
    setPendingNewThreadPreferences({
      model: { provider: 'deepseek', modelId: 'deepseek-v4-flash' },
      thinkingLevel: 'high',
    })

    const result = await client.createThread()
    await client.sendMessage(result.metadata.id, { content: 'hello' })

    expect(calls).toEqual([
      'create',
      'model:thread-1:deepseek:deepseek-v4-flash',
      'thinking:thread-1:high',
      'send:thread-1',
    ])
    expect(result.metadata.config).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
      thinkingLevel: 'high',
    })
  })
})
