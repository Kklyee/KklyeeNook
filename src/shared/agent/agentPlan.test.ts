import { expect, test } from 'vitest'

import { parseAgentPlan } from './agentPlan'

test('normalizes plan steps and fills omitted statuses', () => {
  expect(
    parseAgentPlan({
      steps: [
        { id: 'analyze', title: ' 分析项目 ' },
        { id: 'edit', title: '修改实现', status: 'in_progress' },
      ],
    }),
  ).toEqual({
    steps: [
      { id: 'analyze', title: '分析项目', status: 'pending' },
      { id: 'edit', title: '修改实现', status: 'in_progress' },
    ],
  })
})

test('unwraps structured tool results', () => {
  expect(
    parseAgentPlan({
      content: [{ type: 'text', text: 'updated' }],
      details: { steps: [{ id: 'step-1', title: '完成', status: 'completed' }] },
    }),
  ).toEqual({ steps: [{ id: 'step-1', title: '完成', status: 'completed' }] })
})

test('rejects plans without stable unique step ids or valid statuses', () => {
  expect(
    parseAgentPlan({
      steps: [
        { id: 'same', title: '第一步' },
        { id: 'same', title: '第二步' },
      ],
    }),
  ).toBeUndefined()
  expect(
    parseAgentPlan({ steps: [{ id: 'step-1', title: '步骤', status: 'blocked' }] }),
  ).toBeUndefined()
})
