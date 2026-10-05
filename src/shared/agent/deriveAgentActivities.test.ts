import { describe, expect, test } from 'vitest'
import type { AgentActivity } from './agentActivity'
import type { AgentEvent } from './agentEvent'
import type { AgentEventEnvelope } from './agentExecutionRecord'
import { deriveAgentActivities } from './deriveAgentActivities'
import { mapToolCallToActivity, webSearchSources } from './agentActivityMapper'
import { currentActivity, groupDuration } from './agentActivityTiming'
import { summarizeAgentActivities } from './agentActivitySummary'
import { formatActivityLabel } from './agentActivityFormatter'

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
      { type: 'step_started', stepId: 'step', ordinal: 1, piTurnIndex: 1, acceptedInputIds: [], reasoning: true },
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
    endedAt: 140,
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

test('ends reasoning before text and separates interleaved reasoning and the next inference', () => {
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
    { type: 'thinking', content: 'First thought.', startedAt: 100, endedAt: 160 },
    { type: 'thinking', content: ' More detail.', startedAt: 170, endedAt: 200 },
    { type: 'thinking', content: 'Second cycle.', startedAt: 300, endedAt: 400 },
  ])
})

test('skips the thinking placeholder when the step runs without reasoning', () => {
  const records = events([
    [
      100,
      { type: 'step_started', stepId: 'step', ordinal: 1, piTurnIndex: 0, acceptedInputIds: [], reasoning: false },
    ],
    [110, { type: 'inference_started' }],
    [200, { type: 'text_delta', text: 'done' }],
    [
      300,
      { type: 'tool_started', call: { id: 'read', toolName: 'read', args: { path: 'file.ts' } } },
    ],
    [400, { type: 'inference_started' }],
    [500, { type: 'agent_completed' }],
  ])
  expect(deriveAgentActivities(records).map((activity) => activity.type)).toEqual(['read'])
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
    ['web_search', 'web_search'],
  ])('%s maps to %s', (toolName, type) => {
    expect(
      mapToolCallToActivity({ id: 'tool', toolName, args: {} }, 'running', { startedAt: 100 }).type,
    ).toBe(type)
  })
  test('keeps web search separate from local search and exposes its sources', () => {
    const webSearchActivity = (activity: AgentActivity) => {
      if (activity.type !== 'web_search') {
        throw new Error(`expected a web_search activity, got ${activity.type}`)
      }
      return activity
    }
    const result = {
      status: 'success' as const,
      content: [{ type: 'text' as const, text: 'Web search results for: electron acrylic' }],
      details: {
        provider: 'tavily',
        query: 'electron acrylic',
        resultCount: 2,
        sources: [
          { title: 'BrowserWindow', url: 'https://www.electronjs.org/docs' },
          { title: 'Issue 1', url: 'https://github.com/electron/electron/issues/1' },
        ],
      },
    }
    const search = mapToolCallToActivity(
      { id: 'web', toolName: 'web_search', args: { query: 'electron acrylic' } },
      'running',
      { startedAt: 100 },
    )
    expect(search).toMatchObject({ type: 'web_search', query: 'electron acrylic' })
    expect(formatActivityLabel(search)).toBe('正在搜索网页 · electron acrylic')

    const completed = webSearchActivity(
      mapToolCallToActivity(
        { id: 'web', toolName: 'web_search', args: { query: 'electron acrylic' } },
        'completed',
        { startedAt: 100, endedAt: 1500 },
        result,
      ),
    )
    expect(completed).toMatchObject({ type: 'web_search', resultCount: 2 })
    expect(completed.errorCode).toBeUndefined()
    expect(formatActivityLabel(completed)).toBe('搜索网页 · electron acrylic')
    expect(webSearchSources(completed.result)).toEqual(result.details.sources)

    const failed = webSearchActivity(
      mapToolCallToActivity(
        { id: 'web', toolName: 'web_search', args: { query: 'electron acrylic' } },
        'failed',
        { startedAt: 100, endedAt: 200 },
        {
          status: 'error',
          content: [
            {
              type: 'text',
              text: 'Web search failed with web_search_invalid_api_key: the configured API key was rejected.',
            },
          ],
          error: {
            code: 'EXECUTION_ERROR',
            message:
              'Web search failed with web_search_invalid_api_key: the configured API key was rejected.',
          },
        },
      ),
    )
    expect(failed).toMatchObject({ type: 'web_search', errorCode: 'web_search_invalid_api_key' })
    expect(failed).toMatchObject({ resultCount: undefined })
    expect(formatActivityLabel(failed)).toBe('网页搜索失败 · API Key 无效')
    expect(webSearchSources(failed.result)).toEqual([])

    expect(
      summarizeAgentActivities([
        completed,
        mapToolCallToActivity(
          { id: 'shell', toolName: 'bash', args: {} },
          'completed',
          { startedAt: 0, endedAt: 1 },
        ),
      ]),
    ).toBe('运行了 1 个命令 · 搜索了 1 次网页')
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
