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
