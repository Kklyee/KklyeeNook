import { expect, test } from 'vitest'
import type { AgentEvent } from './agentEvent'
import type { AgentEventEnvelope } from './agentExecutionRecord'
import { deriveAgentActivities } from './deriveAgentActivities'
import { groupAgentActivities } from './groupAgentActivities'

function records(events: AgentEvent[]): AgentEventEnvelope[] {
  return events.map((event, seq) => ({
    runId: 'run',
    sessionId: 'session',
    seq,
    timestamp: 100 + seq,
    event,
  }))
}

test('splits activities after intermediate text and keeps each summary local', () => {
  const events = records([
    { type: 'inference_started' },
    { type: 'thinking_delta', text: 'Inspect.' },
    { type: 'tool_started', call: { id: 'read', toolName: 'read', args: {} } },
    {
      type: 'tool_finished',
      result: { toolCallId: 'read', toolName: 'read', status: 'success', content: [] },
    },
    { type: 'inference_started' },
    { type: 'text_delta', text: 'Intermediate ' },
    { type: 'text_delta', text: 'reply.' },
    { type: 'inference_finished', failed: false },
    { type: 'inference_started' },
    { type: 'thinking_delta', text: 'Verify.' },
    { type: 'tool_started', call: { id: 'shell', toolName: 'bash', args: {} } },
    {
      type: 'tool_finished',
      result: { toolCallId: 'shell', toolName: 'bash', status: 'success', content: [] },
    },
    { type: 'text_delta', text: 'Final.' },
  ])
  const segments = groupAgentActivities([...events].reverse(), deriveAgentActivities(events))
  expect(segments.map((segment) => segment.textOffset)).toEqual([0, 19])
  expect(
    segments[0]?.activities.filter((activity) => 'call' in activity).map((activity) => activity.id),
  ).toEqual(['read'])
  expect(
    segments[1]?.activities.filter((activity) => 'call' in activity).map((activity) => activity.id),
  ).toEqual(['shell'])
  expect(segments.map((segment) => segment.endedAt)).toEqual([105, 112])
})

test('keeps consecutive inference and parallel tool cycles together until text arrives', () => {
  const events = records([
    { type: 'inference_started' },
    { type: 'tool_started', call: { id: 'one', toolName: 'read', args: {} } },
    { type: 'tool_started', call: { id: 'two', toolName: 'read', args: {} } },
    {
      type: 'tool_finished',
      result: { toolCallId: 'two', toolName: 'read', status: 'success', content: [] },
    },
    { type: 'inference_started' },
    { type: 'thinking_delta', text: 'Next cycle.' },
  ])
  const segments = groupAgentActivities(events, deriveAgentActivities(events))
  expect(segments).toHaveLength(1)
  expect(segments[0]?.endedAt).toBeUndefined()
  expect(segments[0]?.activities.map((activity) => activity.type)).toEqual([
    'thinking',
    'read',
    'read',
    'thinking',
  ])
})

test('keeps reasoning after same-inference text in its own segment', () => {
  const events = records([
    { type: 'inference_started' },
    { type: 'thinking_delta', text: 'Before.' },
    { type: 'text_delta', text: '正文' },
    { type: 'thinking_delta', text: 'After.' },
    { type: 'inference_finished', failed: false },
  ])
  const segments = groupAgentActivities(events, deriveAgentActivities(events))
  expect(segments.map((segment) => segment.textOffset)).toEqual([0, 2])
  expect(
    segments.map((segment) => {
      const activity = segment.activities[0]
      return activity?.type === 'thinking' ? activity.content : undefined
    }),
  ).toEqual(['Before.', 'After.'])
})
