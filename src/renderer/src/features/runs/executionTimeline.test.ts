import { expect, test } from 'vitest'

import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import type { AgentRun } from '@/shared/agent/agentRun'
import { buildExecutionTimeline } from './executionTimeline'

const run: AgentRun = {
  id: 'run-1',
  sessionId: 'session-1',
  status: 'completed',
  createdAt: 100,
  updatedAt: 500,
  startedAt: 100,
  completedAt: 500,
  toolCalls: [],
  toolResults: [],
}

function record(
  id: number,
  timestamp: number,
  event: AgentExecutionRecord['event'],
): AgentExecutionRecord {
  return { id, seq: id, sessionId: run.sessionId, runId: run.id, timestamp, event }
}

test('groups streamed text and pairs tool and approval events', () => {
  const model = buildExecutionTimeline(run, [
    record(1, 100, { type: 'user_message', inputId: 'input-1', delivery: 'initial', text: '请更新 README' }),
    record(2, 100, { type: 'system_prompt', text: 'You are a coding agent.' }),
    record(3, 100, { type: 'agent_started' }),
    record(4, 120, { type: 'text_delta', text: '你' }),
    record(5, 130, { type: 'text_delta', text: '好' }),
    record(6, 150, {
      type: 'approval_required',
      approvalId: 'approval-1',
      call: { id: 'tool-1', toolName: 'write', args: { path: 'README.md' } },
    }),
    record(7, 200, {
      type: 'approval_resolved',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      decision: 'allow',
    }),
    record(8, 210, {
      type: 'tool_started',
      call: { id: 'tool-1', toolName: 'write', args: { path: 'README.md' } },
    }),
    record(9, 410, {
      type: 'tool_finished',
      result: { toolCallId: 'tool-1', toolName: 'write', content: [{ type: 'text', text: 'ok' }], status: 'success' },
    }),
    record(10, 500, { type: 'agent_completed' }),
  ])

  expect(model.totalMs).toBe(400)
  expect(model.items.find((item) => item.kind === 'system')?.summary).toBe(
    'You are a coding agent.',
  )
  expect(model.items.find((item) => item.kind === 'user')?.summary).toBe('请更新 README')
  expect(model.items.find((item) => item.kind === 'assistant')?.summary).toBe('你好')
  expect(model.items.some((item) => item.title === 'Agent 开始执行')).toBe(false)
  expect(model.items.some((item) => item.title === 'Agent 执行完成')).toBe(false)
  expect(model.items.find((item) => item.kind === 'approval')).toMatchObject({
    durationMs: 50,
    status: 'completed',
    summary: '{"path":"README.md"}',
  })
  expect(model.items.find((item) => item.kind === 'tool')).toMatchObject({
    durationMs: 200,
    status: 'completed',
    summary: '{"path":"README.md"} → ok',
  })
  expect(model.items.map((item) => item.kind)).toEqual([
    'system',
    'user',
    'assistant',
    'approval',
    'tool',
  ])
})

test('places the system prompt before the user message', () => {
  const model = buildExecutionTimeline(run, [
    record(1, 100, { type: 'user_message', inputId: 'input-1', delivery: 'initial', text: '请更新 README' }),
    record(2, 100, { type: 'system_prompt', text: 'You are a coding agent.' }),
  ])

  expect(model.items).toMatchObject([
    { kind: 'system', summary: 'You are a coding agent.' },
    { kind: 'user', summary: '请更新 README' },
  ])
})

test('keeps successful and failed tool results distinct', () => {
  const model = buildExecutionTimeline(run, [
    record(1, 110, { type: 'tool_started', call: { id: 'success', toolName: 'read', args: {} } }),
    record(2, 120, {
      type: 'tool_finished',
      result: { toolCallId: 'success', toolName: 'read', content: [{ type: 'text', text: 'ok' }], status: 'success' },
    }),
    record(3, 130, { type: 'tool_started', call: { id: 'failure', toolName: 'bash', args: {} } }),
    record(4, 140, {
      type: 'tool_finished',
      result: { toolCallId: 'failure', toolName: 'bash', content: [{ type: 'text', text: 'exit 1' }], status: 'error' },
    }),
  ])

  expect(model.items.filter((item) => item.kind === 'tool')).toMatchObject([
    { title: 'read', status: 'completed', summary: '{} → ok' },
    { title: 'bash', status: 'failed', summary: '{} → exit 1' },
  ])
})

test('uses text content from structured tool results in the row preview', () => {
  const model = buildExecutionTimeline(run, [
    record(1, 110, {
      type: 'tool_started',
      call: { id: 'bash-1', toolName: 'bash', args: { command: 'npm test' } },
    }),
    record(2, 140, {
      type: 'tool_finished',
      result: {
        toolCallId: 'bash-1',
        toolName: 'bash',
        content: [{ type: 'text', text: '12 tests passed' }],
        status: 'success',
      },
    }),
  ])

  expect(model.items[0]?.summary).toBe('{"command":"npm test"} → 12 tests passed')
})

test('shows completed and failed context compaction events', () => {
  const completed = buildExecutionTimeline(run, [
    record(1, 120, { type: 'context_compaction_started', reason: 'threshold' }),
    record(2, 180, {
      type: 'context_compaction_completed',
      reason: 'threshold',
      tokensBefore: 112_000,
      estimatedTokensAfter: 36_000,
    }),
  ])

  expect(completed.items).toMatchObject([
    {
      kind: 'compaction',
      title: '已整理上下文',
      summary: '112K → ~36K\n达到自动压缩阈值',
      status: 'completed',
      durationMs: 60,
    },
  ])

  const failed = buildExecutionTimeline(run, [
    record(3, 120, { type: 'context_compaction_started', reason: 'overflow' }),
    record(4, 150, {
      type: 'context_compaction_failed',
      reason: 'overflow',
      error: 'context window is full',
    }),
  ])

  expect(failed.items).toMatchObject([
    {
      kind: 'compaction',
      title: '上下文整理失败',
      summary: '上下文溢出\ncontext window is full',
      status: 'failed',
      durationMs: 30,
    },
  ])
})

test('projects step budgets and keeps estimated and actual compaction usage distinct', () => {
  const records = [
    { ...record(1, 100, { type: 'step_started', stepId: 's1', ordinal: 1, piTurnIndex: 0, acceptedInputIds: [] }), stepId: 's1' },
    { ...record(2, 110, { type: 'context_usage_updated', source: 'step', usage: { tokens: 31_000, contextWindow: 128_000 } }), stepId: 's1' },
    { ...record(3, 120, { type: 'step_started', stepId: 's2', ordinal: 2, piTurnIndex: 1, acceptedInputIds: [] }), stepId: 's2' },
    { ...record(4, 140, { type: 'context_usage_updated', source: 'step', usage: { tokens: 76_000, contextWindow: 128_000 } }), stepId: 's2' },
    record(5, 150, { type: 'context_compaction_started', reason: 'threshold', tokensBefore: 76_421, contextWindow: 128_000 }),
    record(6, 170, { type: 'context_compaction_completed', reason: 'threshold', tokensBefore: 76_421, estimatedTokensAfter: 24_180, contextWindow: 128_000 }),
    record(7, 171, { type: 'context_usage_updated', source: 'compaction', usage: { tokens: 25_044, contextWindow: 128_000 } }),
    { ...record(8, 180, { type: 'step_started', stepId: 's3', ordinal: 3, piTurnIndex: 2, acceptedInputIds: [] }), stepId: 's3' },
    { ...record(9, 190, { type: 'context_usage_updated', source: 'step', usage: { tokens: 33_000, contextWindow: 128_000 } }), stepId: 's3' },
  ]
  const model = buildExecutionTimeline(run, records.reverse())
  expect(model.stepContextUsage).toEqual({
    s1: { tokens: 31_000, contextWindow: 128_000 },
    s2: { tokens: 76_000, contextWindow: 128_000 },
    s3: { tokens: 33_000, contextWindow: 128_000 },
  })
  expect(model.items).toHaveLength(1)
  expect(model.items[0]).toMatchObject({
    title: '已整理上下文', timestamp: 150, durationMs: 20, summary: '76K → ~24K\n达到自动压缩阈值',
    detail: { reason: 'threshold', tokensBefore: 76_421, estimatedTokensAfter: 24_180, actualTokensAfter: 25_044, contextWindow: 128_000, usageTimestamp: 171 },
  })
})

test('does not convert a compaction estimate into actual usage', () => {
  const model = buildExecutionTimeline(run, [
    record(1, 100, { type: 'context_compaction_completed', reason: 'manual', estimatedTokensAfter: 24_000 }),
    record(2, 110, { type: 'context_usage_updated', source: 'compaction', usage: { contextWindow: 128_000 } }),
    record(3, 120, { type: 'context_usage_updated', source: 'step', usage: { tokens: 33_000, contextWindow: 128_000 } }),
  ])
  expect(model.items[0]).toMatchObject({ summary: '~24K\n手动整理', detail: { estimatedTokensAfter: 24_000, actualTokensAfter: undefined, contextWindow: 128_000 } })
  expect(model.stepContextUsage).toEqual({})
})

test('retains failure context from the compaction start event', () => {
  const model = buildExecutionTimeline(run, [
    record(1, 100, { type: 'context_compaction_started', reason: 'overflow', tokensBefore: 126_000, contextWindow: 128_000 }),
    record(2, 110, { type: 'context_compaction_failed', reason: 'overflow', error: 'failed' }),
  ])
  expect(model.items[0]).toMatchObject({
    title: '上下文整理失败', summary: '上下文溢出\n126K / 128K\nfailed',
    detail: { reason: 'overflow', tokensBefore: 126_000, contextWindow: 128_000, error: 'failed' },
  })
})

test('shows plan updates in the execution timeline', () => {
  const model = buildExecutionTimeline(run, [
    record(1, 120, {
      type: 'plan_updated',
      plan: {
        steps: [
          { id: 'one', title: '分析项目', status: 'completed' },
          { id: 'two', title: '修改实现', status: 'in_progress' },
          { id: 'three', title: '运行测试', status: 'pending' },
        ],
      },
    }),
  ])

  expect(model.items).toMatchObject([
    { kind: 'plan', title: '更新计划', summary: '1 / 3', detail: { steps: expect.any(Array) } },
  ])
})
