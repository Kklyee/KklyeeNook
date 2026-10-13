import { expect, test } from 'vitest'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import type { AgentEvent, EntryRecord, SnapshotEvent } from '@earendil-works/pi-durable'
import {
  applyAgentEvent,
  emptyDurableProjectionState,
  projectDurableThread,
  reduceDurableFrame,
} from '@kklyeenook/shared/agent/projection'
import { emptySnapshot } from './projection'

const entry = (id: number, message: NonNullable<EntryRecord['model']>[number]): EntryRecord => ({
  id: id as never, conversationId: 1 as never, kind: `pi.${message.role}`,
  data: {}, model: [message],
})
const reduce = (snapshot: SnapshotEvent, events: readonly AgentEvent[]) => events.reduce(applyAgentEvent, snapshot)

test('execution includes intermediate replies and exposes only the terminal response as final', () => {
  const snapshot = emptySnapshot()
  const progress = { ...fauxAssistantMessage('Checking files'), timestamp: 1000, stopReason: 'toolUse' as const }
  progress.content.push({ type: 'toolCall', id: 'read', name: 'read', arguments: {} })
  const final = { ...fauxAssistantMessage('Fixed'), timestamp: 9000, durationMs: 2000 }
  snapshot.entries = [
    entry(1, { role: 'user', content: 'Fix', timestamp: 0 }),
    entry(2, progress),
    entry(3, { role: 'toolResult', toolCallId: 'read', toolName: 'read', content: [], isError: false, timestamp: 8000 }),
    entry(4, final),
  ]
  const projected = projectDurableThread({ ...emptyDurableProjectionState(), snapshot })
  expect(projected.messages[1].metadata?.custom?.execution).toEqual({ startedAt: 1000, endedAt: 11000, finalPartIndex: 2 })
})

test('streaming replies stay in the execution process until a terminal response arrives', () => {
  const snapshot = emptySnapshot()
  const progress = { ...fauxAssistantMessage('Checking'), timestamp: 1000, stopReason: 'toolUse' as const }
  snapshot.entries = [entry(1, progress)]
  snapshot.generation = { attempt: 1, message: { ...fauxAssistantMessage('Partial'), timestamp: 4000, stopReason: 'pending' } }
  const projected = projectDurableThread({ ...emptyDurableProjectionState(), snapshot })
  expect(projected.messages[0].metadata?.custom?.execution).toEqual({ startedAt: 1000 })
})

test('a failed response does not promote intermediate progress to a final answer', () => {
  const snapshot = emptySnapshot()
  snapshot.entries = [
    entry(1, { ...fauxAssistantMessage('Checking'), timestamp: 1000, stopReason: 'toolUse' }),
    entry(2, { ...fauxAssistantMessage(''), timestamp: 5000, durationMs: 3000, stopReason: 'error', errorMessage: 'Failed' }),
  ]
  const projected = projectDurableThread({ ...emptyDurableProjectionState(), snapshot })
  expect(projected.messages[0].metadata?.custom?.execution).toEqual({ startedAt: 1000, endedAt: 8000 })
  expect(projected.messages[0].status).toMatchObject({ type: 'incomplete', error: 'Failed' })
})

test('message model metadata comes from its response and survives later configuration changes', () => {
  const snapshot = emptySnapshot()
  const response = { ...fauxAssistantMessage('reply'), provider: 'original', model: 'old-model', thinkingLevel: 'high' as const }
  snapshot.entries = [entry(1, response)]
  snapshot.agent = { model: { provider: 'new', modelId: 'new-model' }, thinkingLevel: 'low' }
  const projected = projectDurableThread({ ...emptyDurableProjectionState(), snapshot })
  expect(projected.messages[0].metadata?.custom?.durable).toMatchObject({ provider: 'original', model: 'old-model', thinkingLevel: 'high' })
  snapshot.entries = [entry(1, fauxAssistantMessage('legacy'))]
  expect(projectDurableThread({ ...emptyDurableProjectionState(), snapshot }).messages[0].metadata?.custom?.durable).toHaveProperty('thinkingLevel', undefined)
})

test('collaboration results stay with their own call even when a provider reuses a tool call ID', () => {
  const snapshot = emptySnapshot()
  const call = () => {
    const message = fauxAssistantMessage('')
    message.content = [{ type: 'toolCall', id: 'reused', name: 'bot_request_task', arguments: { botId: 'coder', instruction: 'Review' } }]
    return message
  }
  snapshot.entries = [
    entry(1, { role: 'user', content: 'First', timestamp: 1 }),
    entry(2, call()),
    entry(3, { role: 'toolResult', toolCallId: 'reused', toolName: 'bot_request_task', content: [], details: { collaborationId: 'first' }, isError: false, timestamp: 2 }),
    entry(4, { role: 'user', content: 'Second', timestamp: 3 }),
    entry(5, call()),
    entry(6, { role: 'toolResult', toolCallId: 'reused', toolName: 'bot_request_task', content: [], details: { collaborationId: 'second' }, isError: false, timestamp: 4 }),
  ]
  const messages = projectDurableThread({ snapshot, approvals: [], queue: [], sequence: 0 }).messages
  const calls = messages.flatMap((message) => typeof message.content === 'string' ? [] : message.content).filter((part) => part.type === 'tool-call')
  expect(calls.map((part) => part.result)).toEqual([
    expect.objectContaining({ details: { collaborationId: 'first' } }),
    expect.objectContaining({ details: { collaborationId: 'second' } }),
  ])
})

test('history projects structured mention identity from persisted metadata without parsing plain at-text', () => {
  const snapshot = emptySnapshot()
  const mentions = [{ botId: 'coder', displayName: 'Coder', start: 0, end: 6 }]
  snapshot.entries = [
    entry(1, { role: 'user', content: '@Coder status?', timestamp: 1 }),
    { id: 2 as never, conversationId: 1 as never, kind: 'nook.mentions', data: { entryId: 1, mentions } },
    entry(3, { role: 'user', content: '@Coder plain text', timestamp: 3 }),
  ]
  const messages = projectDurableThread({ snapshot, approvals: [], queue: [], sequence: 0 }).messages
  expect(messages[0].metadata?.custom?.botMentions).toEqual({ entryId: 1, mentions })
  expect(messages[1].metadata?.custom?.botMentions).toBeUndefined()
})

test('closes the previous assistant response when steer is consumed during a run', () => {
  const snapshot = emptySnapshot()
  const assistant = fauxAssistantMessage('')
  assistant.stopReason = 'toolUse'
  assistant.content = [{ type: 'thinking', thinking: 'Original reasoning' }]
  snapshot.run = { inputs: [1 as never, 2 as never] }
  snapshot.entries = [
    entry(1, { role: 'user', content: 'Original', timestamp: 1 }),
    entry(2, assistant),
    entry(3, { role: 'user', content: 'Correction', timestamp: 3 }),
  ]
  snapshot.generation = { attempt: 1, message: fauxAssistantMessage('Adjusted response') }
  const projected = projectDurableThread({ snapshot, approvals: [], queue: [], sequence: 0 })
  const replies = projected.messages.filter(message => message.role === 'assistant')
  expect(replies.map(message => message.status?.type)).toEqual(['complete', 'running'])
  expect(replies.map(message => message.metadata?.custom?.activityInputId)).toEqual(['1', '3'])
  expect(projected.isRunning).toBe(true)
})

test('replays every streamed block and nested tool argument delta without mutating a prior snapshot', () => {
  const first = reduce(emptySnapshot(), [{ type: 'message_start', message: fauxAssistantMessage('') }])
  const result = reduce(first, [{
    type: 'message_update', usage: fauxAssistantMessage('').usage,
    changes: [
      { type: 'text_start', contentIndex: 0, block: { type: 'text', text: 'a' } },
      { type: 'text_delta', contentIndex: 0, delta: 'b' },
      { type: 'thinking_start', contentIndex: 1, block: { type: 'thinking', thinking: 'c' } },
      { type: 'thinking_delta', contentIndex: 1, delta: 'd' },
      { type: 'toolcall_start', contentIndex: 2, block: { type: 'toolCall', id: 'call', name: 'write', arguments: { file: { content: 'e' }, lines: ['f'] } } },
      { type: 'toolcall_delta', contentIndex: 2, path: ['file', 'content'], delta: 'g' },
      { type: 'toolcall_delta', contentIndex: 2, path: ['lines', 0], delta: 'h' },
      { type: 'block', contentIndex: 3, block: { type: 'text', text: 'authoritative' } },
    ],
  }])
  expect(result.generation?.message?.content).toEqual([
    { type: 'text', text: 'ab' }, { type: 'thinking', thinking: 'cd' },
    { type: 'toolCall', id: 'call', name: 'write', arguments: { file: { content: 'eg' }, lines: ['fh'] } },
    { type: 'text', text: 'authoritative' },
  ])
  expect(first.generation?.message?.content).toEqual([{ type: 'text', text: '' }])
  const authoritative = fauxAssistantMessage('final')
  expect(reduce(result, [{ type: 'message_update', usage: authoritative.usage, changes: [{ type: 'message', message: authoritative }] }]).generation?.message).toEqual(authoritative)
  expect(() => reduce(result, [{ type: 'message_update', usage: authoritative.usage, changes: [{ type: 'toolcall_delta', contentIndex: 2, path: ['__proto__', 'polluted'], delta: 'unsafe' }] }])).toThrow()
})

test('retains the official tool output window, replacement details, diagnostics and final result', () => {
  const result = reduce(emptySnapshot(), [
    { type: 'tool_execution_start', toolCallId: 'call', toolName: 'read', args: {} },
    { type: 'tool_execution_update', toolCallId: 'call', toolName: 'read', output: { append: 'abcdef' }, details: { first: true }, diagnostics: [] },
    { type: 'tool_execution_update', toolCallId: 'call', toolName: 'read', output: { trimStart: 3, append: 'ghi' }, details: null },
  ])
  expect(result.tools[0]).toMatchObject({ output: 'defghi', details: null })
  const replaced = reduce(result, [{ type: 'tool_execution_update', toolCallId: 'call', toolName: 'read', output: { set: 'retained' } }])
  const receipt = entry(1, { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [{ type: 'text', text: 'retained' }], isError: false, timestamp: 1 })
  const completed = reduce(replaced, [{ type: 'tool_execution_end', toolCallId: 'call', toolName: 'read', entry: receipt }])
  expect(completed.tools[0]).toMatchObject({ status: 'done', entry: 1, output: 'retained' })
  expect(completed.entries).toEqual([receipt])
  expect(reduce(completed, [{ type: 'tool_execution_end', toolCallId: 'orphan', toolName: 'write' }]).tools[1]).toMatchObject({ status: 'done' })
})

test('projects official retry, deferred polling, compaction, inbox, agent and usage state', () => {
  let current = reduce(emptySnapshot(), [
    { type: 'run_start', inputs: [1 as never] },
    { type: 'auto_retry_start', attempt: 2, at: 10, errorMessage: 'retry' },
    { type: 'inbox_update', items: [{ id: 2 as never, mode: 'followUp' }] },
    { type: 'agent_changed', agent: { model: { provider: 'faux', modelId: 'faux-1' } } },
    { type: 'usage_changed', usage: { models: {}, tools: {} } },
    { type: 'compaction_start', taskId: 3 as never, reason: 'manual', blocking: true },
  ])
  expect(current.generation).toEqual({ attempt: 2, retry: { at: 10, error: 'retry' } })
  expect(current.inbox).toEqual([{ id: 2, mode: 'followUp' }])
  expect(projectDurableThread({ snapshot: current, approvals: [], queue: [], sequence: 0 }).compaction.active).toBe(true)
  current = reduce(current, [
    { type: 'auto_retry_end', attempt: 2 }, { type: 'deferred_poll', pollAt: 20 },
    { type: 'compaction_end', taskId: 3 as never, reason: 'manual' },
  ])
  expect(current.generation).toMatchObject({ attempt: 2, deferred: { pollAt: 20 } })
  expect(current.generation?.retry).toBeUndefined()
  expect(current.compactions).toEqual([])
  current = reduce(current, [{ type: 'run_end', inputs: [1 as never] }])
  expect(projectDurableThread({ snapshot: current, approvals: [], queue: [], sequence: 0 }).isRunning).toBe(false)
})

test('deduplicates final entries and preserves tool results after the run slots disappear', () => {
  const assistant = fauxAssistantMessage('')
  assistant.content = [{ type: 'thinking', thinking: 'opaque', redacted: true }, { type: 'toolCall', id: 'call', name: 'read', arguments: {} }]
  const call = entry(2, assistant)
  const output = entry(3, { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [{ type: 'text', text: 'result' }], isError: false, timestamp: 1 })
  const snapshot = reduce(emptySnapshot(), [
    { type: 'entry_appended', entry: call }, { type: 'message_end', entry: call },
    { type: 'tool_execution_end', toolCallId: 'call', toolName: 'read', entry: output },
    { type: 'run_end', inputs: [1 as never] },
  ])
  expect(snapshot.entries).toHaveLength(2)
  const projected = projectDurableThread({ snapshot, approvals: [], queue: [], sequence: 0 })
  expect(projected.messages[0].content).toContainEqual(expect.objectContaining({ type: 'tool-call', toolCallId: 'call', result: expect.objectContaining({ content: [{ type: 'text', text: 'result' }] }) }))
  expect(JSON.stringify(projected.messages)).not.toContain('opaque')
  expect(projected.isRunning).toBe(false)
})

test('uses authoritative resets and rejects gaps while ignoring repeated delivery', () => {
  const frame = { type: 'reset' as const, threadId: 'thread', epoch: 'epoch', sequence: 0, events: [emptySnapshot()], approvals: [], queue: [] }
  const first = reduceDurableFrame(emptyDurableProjectionState(), frame)
  expect(reduceDurableFrame(first, frame)).toBe(first)
  expect(() => reduceDurableFrame(first, { ...frame, type: 'events', sequence: 2, events: [] })).toThrow('gap')
  const reset = { ...emptySnapshot(), agent: { thinkingLevel: 'high' as const } }
  expect(reduceDurableFrame(first, { ...frame, sequence: 20, events: [reset] }).snapshot).toBe(reset)
  expect(() => reduceDurableFrame(first, { ...frame, epoch: 'next', events: [] })).toThrow('Snapshot required')
})

test('does not render persisted system instructions as empty assistant bubbles', () => {
  const snapshot = emptySnapshot()
  snapshot.entries = [
    entry(1, { role: 'user', content: 'Question', timestamp: 1 }),
    entry(2, { role: 'system', content: '', sections: { identity: 'Private system instructions' }, timestamp: 2 }),
    entry(3, fauxAssistantMessage('Visible answer')),
  ]
  const projected = projectDurableThread({ snapshot, approvals: [], queue: [], sequence: 0 })
  expect(projected.messages.map(message => message.role)).toEqual(['user', 'assistant'])
  expect(JSON.stringify(projected.messages)).not.toContain('Private system instructions')
  expect(projected.transcript).toHaveLength(3)
})

test('events without additional snapshot fields do not invent execution or mutate official state', () => {
  const snapshot = emptySnapshot()
  const events: AgentEvent[] = [
    { type: 'turn_start' }, { type: 'turn_end' },
    { type: 'submission', record: { id: 1, type: 'input', conversationId: 1, status: 'queued' } as never },
    { type: 'task_failed', taskId: 1 as never, kind: 'pi.tool', message: 'unsafe interruption' },
    { type: 'message_start', message: { role: 'user', content: 'hello', timestamp: 0 } },
    { type: 'message_update', usage: fauxAssistantMessage('').usage, changes: [] },
  ]
  expect(reduce(snapshot, events)).toBe(snapshot)
  expect(applyAgentEvent(snapshot, { ...emptySnapshot(), agent: { thinkingLevel: 'low' } }).agent.thinkingLevel).toBe('low')
})
