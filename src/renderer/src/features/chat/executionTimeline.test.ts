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
  artifactIds: [],
}

function record(
  id: number,
  timestamp: number,
  event: AgentExecutionRecord['event'],
): AgentExecutionRecord {
  return { id, sessionId: run.sessionId, runId: run.id, timestamp, event }
}

test('groups streamed text and pairs tool and approval events', () => {
  const model = buildExecutionTimeline(run, [
    record(1, 100, { type: 'user_message', text: '请更新 README' }),
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
      result: { toolCallId: 'tool-1', toolName: 'write', output: 'ok', success: true },
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
})

test('keeps successful and failed tool results distinct', () => {
  const model = buildExecutionTimeline(run, [
    record(1, 110, { type: 'tool_started', call: { id: 'success', toolName: 'read', args: {} } }),
    record(2, 120, {
      type: 'tool_finished',
      result: { toolCallId: 'success', toolName: 'read', output: 'ok', success: true },
    }),
    record(3, 130, { type: 'tool_started', call: { id: 'failure', toolName: 'bash', args: {} } }),
    record(4, 140, {
      type: 'tool_finished',
      result: { toolCallId: 'failure', toolName: 'bash', output: 'exit 1', success: false },
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
        output: { content: [{ type: 'text', text: '12 tests passed' }] },
        success: true,
      },
    }),
  ])

  expect(model.items[0]?.summary).toBe('{"command":"npm test"} → 12 tests passed')
})
