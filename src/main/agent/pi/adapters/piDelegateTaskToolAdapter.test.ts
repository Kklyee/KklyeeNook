import { expect, test, vi } from 'vitest'

import type { DelegateTaskResult } from '@/shared/agent/delegateTask'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import { registerPiDelegateTaskTool } from './piDelegateTaskToolAdapter'

test('passes the active parent run to delegate_task and returns structured details', async () => {
  const result: DelegateTaskResult = { runId: 'child-1', status: 'completed', result: 'done' }
  const execute = vi.fn(async () => result)
  const registry = new ToolRegistry()
  registerPiDelegateTaskTool(registry, execute)
  const [tool] = registry.resolve<{
    execute: (id: string, input: unknown) => Promise<{ details: DelegateTaskResult }>
  }>('pi', ['delegate_task'], { cwd: process.cwd(), getRunId: () => 'parent-1' })

  const toolResult = await tool!.execute('call-1', {
    task: 'inspect the database',
    skillIds: ['database-review'],
    context: 'schema only',
  })

  expect(execute).toHaveBeenCalledWith('parent-1', {
    task: 'inspect the database',
    skillIds: ['database-review'],
    context: 'schema only',
  })
  expect(toolResult.details).toEqual(result)
})
