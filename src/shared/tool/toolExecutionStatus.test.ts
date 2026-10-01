import { expect, test } from 'vitest'
import { resolveToolExecutionStatus } from './toolExecutionStatus'

test('a completed call with an error result is a failed operation', () => {
  expect(
    resolveToolExecutionStatus({ type: 'complete' }, true, '仅可查看模式禁止修改文件'),
  ).toEqual({ type: 'incomplete', reason: 'error', error: '仅可查看模式禁止修改文件' })
})

test('successful, running, approval and cancelled calls keep their state', () => {
  for (const status of [
    { type: 'complete' },
    { type: 'running' },
    { type: 'requires-action', reason: 'tool-calls' },
    { type: 'incomplete', reason: 'cancelled' },
  ] as const)
    expect(resolveToolExecutionStatus(status, false)).toBe(status)
})
