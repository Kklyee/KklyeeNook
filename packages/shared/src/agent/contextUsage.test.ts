import { expect, test } from 'vitest'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import { estimateMessageTokens, estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import type { Message } from '@earendil-works/pi-ai'
import type { EntryRecord, SnapshotEvent } from '@earendil-works/pi-durable'
import { snapshotContextUsage } from './projection'
import { toAgentContextUsage } from './agentContextUsage'
import { calculateAgentContextBudget } from './agentContextBudget'
import { DEFAULT_AGENT_COMPACTION_SETTINGS } from './agentConfig'

const entry = (id: number, message: Message): EntryRecord => ({
  id: id as never, conversationId: 1 as never, kind: `pi.${message.role}`, model: [message],
})
const snapshot = (entries: EntryRecord[] = []): SnapshotEvent => ({
  type: 'snapshot', entries, agent: {}, tools: [], inbox: [], compactions: [], usage: { models: {}, tools: {} },
})
const measured = () => {
  const message = fauxAssistantMessage('reply')
  message.timestamp = 10
  message.usage = { ...message.usage, input: 591, cacheRead: 10752, cacheWrite: 0, output: 576, totalTokens: 11919 }
  return message
}

test('keeps measured context and cache usage when the next stream starts with zero usage', () => {
  const state = snapshot([entry(1, measured())])
  state.generation = { attempt: 1, message: fauxAssistantMessage('') }
  const usage = snapshotContextUsage(state, 1_000_000)
  expect(usage.tokens).toBe(11919)
  expect(usage.percent).toBeCloseTo(1.1919)
  expect(usage.latestRequest).toEqual({ input: 11343, output: 576, cacheRead: 10752, cacheWrite: 0 })
  expect(usage.latestRequest!.cacheRead / usage.latestRequest!.input * 100).toBeCloseTo(94.79, 2)
})

test('uses the latest streamed measurement instead of accumulating earlier requests', () => {
  const state = snapshot([entry(1, measured())])
  const live = measured()
  live.timestamp = 20
  live.usage = { ...live.usage, input: 294, cacheRead: 11264, output: 407, totalTokens: 11965 }
  state.generation = { attempt: 1, message: live }
  expect(snapshotContextUsage(state).tokens).toBe(11965)
  expect(snapshotContextUsage(state).latestRequest?.input).toBe(11558)
})

test('adds new tool results to the measured context while waiting for the next usage', () => {
  const result: Message = { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [{ type: 'text', text: 'new tool result' }], isError: false, timestamp: 20 }
  const usage = snapshotContextUsage(snapshot([entry(1, measured()), entry(2, result)]))
  expect(usage.tokens).toBe(11919 + estimateMessageTokens(result))
  expect(usage.estimated).toBe(true)
  expect(usage.breakdown?.toolResults).toBe(estimateMessageTokens(result))
})

test('estimates the first request and the new context after compaction without inventing zero usage', () => {
  const system: Message = { role: 'system', content: 'system instructions', timestamp: 1 }
  const user: Message = { role: 'user', content: 'summary and question', timestamp: 2 }
  const state = snapshot([entry(1, system), { ...entry(2, user), kind: 'pi.compaction', head: 2 as never }])
  state.generation = { attempt: 1, message: fauxAssistantMessage('') }
  const usage = snapshotContextUsage(state)
  expect(usage.tokens).toBe(estimateMessageTokens(system) + estimateMessageTokens(user))
  expect(usage.estimated).toBe(true)
  expect(usage.latestRequest).toBeUndefined()
  expect(snapshotContextUsage(snapshot()).tokens).toBeNull()
})

test('replays prompt sections and tool removal instead of counting obsolete definitions', () => {
  const state = snapshot([
    entry(1, { role: 'system', content: '', sections: { identity: 'obsolete identity', workspace: 'project file' }, toolsAdded: [{ name: 'read', description: 'read file', parameters: { type: 'object' } }, { name: 'write', description: 'write file', parameters: { type: 'object' } }], timestamp: 1 }),
    entry(2, { role: 'system', content: '', sections: { identity: 'current identity', workspace: null }, toolsRemoved: [{ name: 'write' }], timestamp: 2 }),
  ])
  const breakdown = snapshotContextUsage(state).breakdown!
  expect(breakdown.system).toBe(estimateTextTokens('current identity'))
  expect(breakdown.files).toBe(0)
  expect(breakdown.tools).toBe(estimateTextTokens(JSON.stringify([{ name: 'read', description: 'read file', parameters: { type: 'object' } }])))
})

test('separates instruction files, attached files, images and tool results', () => {
  const files = [{ name: 'a.txt', content: 'attached content' }]
  const section = `<input-context>\n${JSON.stringify({ files, memories: [{ content: 'memory' }] }, null, 2)}\n</input-context>`
  const state = snapshot([
    entry(1, { role: 'system', content: 'system', sections: { workspace: 'AGENTS.md contents', 'selected-skills': 'skill contents', 'input-context': section }, timestamp: 1 }),
    entry(2, { role: 'user', content: [{ type: 'text', text: 'question' }, { type: 'image', data: 'opaque', mimeType: 'image/png' }], timestamp: 2 }),
    entry(3, { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [{ type: 'text', text: 'file read with tool' }], isError: false, timestamp: 3 }),
  ])
  const breakdown = snapshotContextUsage(state).breakdown!
  const image = estimateMessageTokens({ role: 'user', content: [{ type: 'image', data: 'opaque', mimeType: 'image/png' }], timestamp: 2 })
  expect(breakdown.files).toBe(estimateTextTokens('AGENTS.md contents') + estimateTextTokens('skill contents') + estimateTextTokens(JSON.stringify(files, null, 2)) + image)
  expect(breakdown.conversation).toBe(estimateTextTokens('question'))
  expect(breakdown.toolResults).toBe(estimateTextTokens('file read with tool'))
})

test('applies context edits and excludes failed answers from context classification', () => {
  const failed = measured()
  failed.stopReason = 'error'
  const state = snapshot([
    entry(1, { role: 'user', content: 'omitted', timestamp: 1 }),
    entry(2, { role: 'user', content: 'obsolete', timestamp: 2 }),
    entry(3, failed),
    { ...entry(4, { role: 'user', content: '', timestamp: 20 }), edits: [{ target: 1 as never, action: 'omit' }, { target: 2 as never, action: 'replace', messages: [{ role: 'user', content: 'replacement', timestamp: 2 }] }] },
  ])
  const usage = snapshotContextUsage(state)
  expect(usage.tokens).toBe(estimateTextTokens('replacement'))
  expect(usage.breakdown?.conversation).toBe(usage.tokens)
  expect(usage.latestRequest).toBeUndefined()
})

test('preserves category and request details through desktop and remote budgets', () => {
  const projected = snapshotContextUsage(snapshot([entry(1, measured())]), 1_000_000)
  const usage = toAgentContextUsage(projected)
  const budget = calculateAgentContextBudget(usage, DEFAULT_AGENT_COMPACTION_SETTINGS)
  expect(budget.breakdown).toEqual(projected.breakdown)
  expect(budget.latestRequest).toEqual(projected.latestRequest)
  expect(budget.estimated).toBe(false)
  expect(budget.usedPercent).toBe(11919 / 1_000_000)
})
