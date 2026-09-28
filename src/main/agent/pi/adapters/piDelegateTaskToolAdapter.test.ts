import { expect, test, vi } from 'vitest'

import type { DelegateTaskProgress, DelegateTaskResult } from '@/shared/agent/delegateTask'
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

  expect(execute).toHaveBeenCalledWith(
    'parent-1',
    { task: 'inspect the database', skillIds: ['database-review'], context: 'schema only' },
    expect.any(Function),
  )
  expect(toolResult.details).toEqual(result)
})

test('streams child progress before delegate_task resolves', async () => {
  const result: DelegateTaskResult = { runId: 'child-1', status: 'completed', result: 'done' }
  const progress: DelegateTaskProgress = {
    runId: 'child-1',
    name: '星河分析员',
    task: 'inspect the database',
    status: 'running',
    summary: '正在检查文件',
  }
  let release: () => void = () => undefined
  const execute = vi.fn(
    async (
      _parentRunId: string,
      _input: unknown,
      onProgress?: (value: DelegateTaskProgress) => void,
    ) => {
      onProgress?.(progress)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return result
    },
  )
  const registry = new ToolRegistry()
  registerPiDelegateTaskTool(registry, execute)
  const [tool] = registry.resolve<{
    execute: (
      id: string,
      input: unknown,
      signal?: AbortSignal,
      onUpdate?: (value: { details: unknown }) => void,
    ) => Promise<{ details: DelegateTaskResult }>
  }>('pi', ['delegate_task'], { cwd: process.cwd(), getRunId: () => 'parent-1' })

  const updates: Array<{ details: unknown }> = []
  const promise = tool!.execute('call-1', { task: progress.task }, undefined, (value) =>
    updates.push(value),
  )

  await vi.waitFor(() => expect(updates[0]?.details).toEqual(progress))
  release()
  await expect(promise).resolves.toMatchObject({ details: result })
})
