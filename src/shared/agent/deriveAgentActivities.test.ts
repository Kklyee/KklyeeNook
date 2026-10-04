import { describe, expect, test } from 'vitest'
import type { AgentEvent } from './agentEvent'
import type { AgentEventEnvelope } from './agentExecutionRecord'
import { deriveAgentActivities } from './deriveAgentActivities'
import { mapToolCallToActivity } from './agentActivityMapper'
import { currentActivity, groupDuration } from './agentActivityTiming'
import { summarizeAgentActivities } from './agentActivitySummary'

function events(entries: [number, AgentEvent][]): AgentEventEnvelope[] {
  return entries.map(([timestamp, event], seq) => ({
    sessionId: 'session',
    runId: 'run',
    stepId: 'step',
    seq,
    timestamp,
    event,
  }))
}

test('keeps reasoning per inference, ends thinking at tool start, and retains tool failure timing', () => {
  const records = events([
    [
      100,
      { type: 'step_started', stepId: 'step', ordinal: 1, piTurnIndex: 1, acceptedInputIds: [] },
    ],
    [110, { type: 'inference_started' }],
    [120, { type: 'thinking_delta', text: 'Inspect the renderer.\n' }],
    [130, { type: 'thinking_delta', text: 'Then check the runtime.' }],
    [140, { type: 'inference_finished', failed: false }],
    [
      150,
      {
        type: 'tool_started',
        call: { id: 'read', toolName: 'read', args: { path: 'renderer.tsx' } },
      },
    ],
    [
      180,
      {
        type: 'tool_finished',
        result: { toolCallId: 'read', toolName: 'read', status: 'success', content: [] },
      },
    ],
    [200, { type: 'inference_started' }],
    [220, { type: 'thinking_delta', text: 'Verify the implementation.' }],
    [
      250,
      {
        type: 'tool_started',
        call: { id: 'shell', toolName: 'bash', args: { command: 'npm test' } },
      },
    ],
    [
      500,
      {
        type: 'tool_finished',
        result: {
          toolCallId: 'shell',
          toolName: 'bash',
          status: 'error',
          content: [{ type: 'text', text: 'failed' }],
          details: { exitCode: 1 },
        },
      },
    ],
    [510, { type: 'agent_failed', error: 'Tests failed' }],
  ])
  const activities = deriveAgentActivities(records)
  expect(activities.map((activity) => activity.type)).toEqual([
    'thinking',
    'read',
    'thinking',
    'shell',
  ])
  expect(activities[0]).toMatchObject({
    status: 'completed',
    startedAt: 100,
    endedAt: 150,
    content: 'Inspect the renderer.\nThen check the runtime.',
  })
  expect(activities[2]).toMatchObject({
    startedAt: 200,
    endedAt: 250,
    content: 'Verify the implementation.',
  })
  expect(activities[3]).toMatchObject({
    status: 'failed',
    startedAt: 250,
    endedAt: 500,
    exitCode: 1,
  })
  expect(currentActivity(activities)?.id).toBe('shell')
  expect(
    activities.every(
      (activity) => activity.startedAt !== undefined && activity.endedAt !== undefined,
    ),
  ).toBe(true)
})

test('derives live reasoning without ending it between stream chunks', () => {
  const activities = deriveAgentActivities(
    events([
      [100, { type: 'inference_started' }],
      [150, { type: 'thinking_delta', text: 'First ' }],
      [200, { type: 'thinking_delta', text: 'second' }],
    ]),
  )
  expect(activities).toMatchObject([
    { type: 'thinking', status: 'running', startedAt: 100, content: 'First second' },
  ])
  expect(activities[0]?.endedAt).toBeUndefined()
  expect(groupDuration(activities, 450)).toBe(350)
})

test('keeps interleaved reasoning in one inference and separates the next inference without tools', () => {
  const activities = deriveAgentActivities(
    events([
      [100, { type: 'inference_started' }],
      [150, { type: 'thinking_delta', text: 'First thought.' }],
      [160, { type: 'text_delta', text: 'Working.' }],
      [170, { type: 'thinking_delta', text: ' More detail.' }],
      [200, { type: 'inference_finished', failed: false }],
      [300, { type: 'inference_started' }],
      [350, { type: 'thinking_delta', text: 'Second cycle.' }],
      [400, { type: 'agent_completed' }],
    ]),
  )
  expect(activities).toMatchObject([
    { type: 'thinking', content: 'First thought. More detail.', startedAt: 100, endedAt: 300 },
    { type: 'thinking', content: 'Second cycle.', startedAt: 300, endedAt: 400 },
  ])
})

test('uses approval as current activity and counts its wait until resolution', () => {
  const call = { id: 'shell', toolName: 'bash', args: { command: 'npm test' } }
  const records = events([
    [100, { type: 'inference_started' }],
    [200, { type: 'tool_started', call }],
    [250, { type: 'approval_required', approvalId: 'approval', call }],
  ])
  const waiting = deriveAgentActivities(records)
  expect(currentActivity(waiting)).toMatchObject({
    id: 'approval',
    status: 'waiting',
    startedAt: 250,
  })
  records.push({
    ...records[0]!,
    seq: 4,
    timestamp: 1250,
    event: {
      type: 'approval_resolved',
      approvalId: 'approval',
      toolCallId: 'shell',
      decision: 'allow',
    },
  })
  const resolved = deriveAgentActivities(records)
  expect(resolved.find((activity) => activity.id === 'approval')).toMatchObject({
    status: 'completed',
    endedAt: 1250,
  })
  expect(currentActivity(resolved)?.id).toBe('shell')
})

test('closes inference, unfinished tools and approval on cancellation or interruption', () => {
  const call = { id: 'read', toolName: 'read', args: {} }
  const records = events([
    [100, { type: 'inference_started' }],
    [200, { type: 'tool_started', call }],
    [210, { type: 'approval_required', approvalId: 'approval', call }],
    [300, { type: 'agent_aborted' }],
  ])
  expect(deriveAgentActivities(records).slice(1)).toMatchObject([
    { status: 'failed', endedAt: 300 },
    { status: 'failed', endedAt: 300 },
  ])
  expect(
    deriveAgentActivities(records.slice(0, 1), { status: 'interrupted', updatedAt: 350 }),
  ).toMatchObject([{ status: 'failed', endedAt: 350 }])
})

test('uses first start to last end for concurrent tools and preserves equal-time event order', () => {
  const records = events([
    [100, { type: 'tool_started', call: { id: 'one', toolName: 'read', args: { path: 'one' } } }],
    [100, { type: 'tool_started', call: { id: 'two', toolName: 'read', args: { path: 'two' } } }],
    [
      500,
      {
        type: 'tool_finished',
        result: { toolCallId: 'two', toolName: 'read', status: 'success', content: [] },
      },
    ],
    [
      600,
      {
        type: 'tool_finished',
        result: { toolCallId: 'one', toolName: 'read', status: 'success', content: [] },
      },
    ],
  ])
  const activities = deriveAgentActivities([...records].reverse())
  expect(activities.map((activity) => activity.id)).toEqual(['one', 'two'])
  expect(groupDuration(activities, 1000)).toBe(500)
})

test('replays legacy thinking deltas as separate cycles around tools', () => {
  const activities = deriveAgentActivities(
    events([
      [100, { type: 'thinking_delta', text: 'Inspect.' }],
      [200, { type: 'tool_started', call: { id: 'read', toolName: 'read', args: {} } }],
      [
        300,
        {
          type: 'tool_finished',
          result: { toolCallId: 'read', toolName: 'read', status: 'success', content: [] },
        },
      ],
      [400, { type: 'thinking_delta', text: 'Conclude.' }],
      [500, { type: 'agent_completed' }],
    ]),
  )
  expect(activities.map((activity) => activity.type)).toEqual(['thinking', 'read', 'thinking'])
  expect(activities[2]).toMatchObject({ startedAt: 400, endedAt: 500, content: 'Conclude.' })
})

describe('central tool mapping', () => {
  test.each([
    ['Read', 'read'],
    ['Search', 'search'],
    ['Grep', 'search'],
    ['Glob', 'glob'],
    ['find', 'glob'],
    ['Edit', 'edit'],
    ['Write', 'write'],
    ['Shell', 'shell'],
    ['bash', 'shell'],
    ['Approval', 'approval'],
    ['delegate_task', 'tool'],
  ])('%s maps to %s', (toolName, type) => {
    expect(
      mapToolCallToActivity({ id: 'tool', toolName, args: {} }, 'running', { startedAt: 100 }).type,
    ).toBe(type)
  })
  test('derives line stats and summarizes successful unique files without thinking counts', () => {
    const result = { status: 'success' as const, content: [] }
    const edit = mapToolCallToActivity(
      {
        id: 'edit',
        toolName: 'edit',
        args: { path: 'file', oldText: 'old\n', newText: 'new\nextra\n' },
      },
      'completed',
      { startedAt: 100, endedAt: 200 },
      result,
    )
    expect(edit).toMatchObject({ additions: 2, deletions: 1 })
    const shell = mapToolCallToActivity(
      { id: 'shell', toolName: 'bash', args: {} },
      'completed',
      { startedAt: 300, endedAt: 400 },
      result,
    )
    expect(
      summarizeAgentActivities([
        edit,
        { ...edit, id: 'another-edit' },
        shell,
        {
          id: 'thinking',
          type: 'thinking',
          content: 'Check',
          status: 'completed',
          startedAt: 0,
          endedAt: 100,
        },
      ]),
    ).toBe('编辑了 1 个文件 · 运行了 1 个命令')
  })
})
