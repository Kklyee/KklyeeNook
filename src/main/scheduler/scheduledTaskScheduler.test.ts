import { expect, test, vi } from 'vitest'

import type { AgentService } from '@/main/agent/agentService'
import type { AgentRun } from '@/shared/agent/agentRun'
import type { AgentRunContext } from '@/main/context/contextBuilder'
import type { ScheduledTaskRepo } from '@/main/db/repositories/scheduledTaskRepo'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
} from '@/shared/scheduler/scheduledTask'
import { ScheduledTaskScheduler } from './scheduledTaskScheduler'

class MemoryScheduledTaskRepo implements ScheduledTaskRepo {
  readonly tasks = new Map<string, ScheduledTask>()

  async findAll() {
    return [...this.tasks.values()]
  }

  async findEnabled() {
    return [...this.tasks.values()].filter((task) => task.enabled)
  }

  async findById(id: string) {
    const task = this.tasks.get(id)
    return task ? { ...task } : undefined
  }

  async save(task: ScheduledTask) {
    this.tasks.set(task.id, { ...task })
  }

  async delete(id: string) {
    this.tasks.delete(id)
  }
}

function completedRun(sessionId: string): AgentRun {
  return {
    id: 'run-1',
    sessionId,
    status: 'completed',
    createdAt: 1,
    updatedAt: 2,
    toolCalls: [],
    toolResults: [],
  }
}

function setup(now = 1_000) {
  const repo = new MemoryScheduledTaskRepo()
  const context: AgentRunContext = {
    attachments: [],
    memories: [
      {
        id: 'memory-1',
        scope: 'global',
        content: 'Use the project conventions.',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  }
  const agentService = {
    createSession: vi.fn(async () => ({ id: 'session-1' })),
    startRun: vi.fn((sessionId: string) => ({
      run: { id: 'run-1' },
      completion: Promise.resolve(completedRun(sessionId)),
    })),
  } as unknown as AgentService
  const notify = vi.fn()
  const scheduler = new ScheduledTaskScheduler(repo, agentService, {
    buildContext: async () => context,
    notify,
    now: () => now,
  })
  return { repo, agentService, notify, scheduler, context }
}

async function createDueTask(
  scheduler: ScheduledTaskScheduler,
  input: Partial<CreateScheduledTaskInput> = {},
): Promise<ScheduledTask> {
  return scheduler.create({
    title: 'Daily project check',
    prompt: 'Check the project',
    schedule: { type: 'once', runAt: 999 },
    ...input,
  })
}

test('creates a dedicated session, starts one run, persists context, and disables a once task', async () => {
  const { scheduler, repo, agentService, notify, context } = setup()
  const task = await createDueTask(scheduler)

  await scheduler.runDueTasks(1_000)

  expect(agentService.createSession).toHaveBeenCalledWith(task.title)
  expect(agentService.startRun).toHaveBeenCalledWith('session-1', {
    prompt: task.prompt,
    context,
    scheduledTaskId: task.id,
  })
  expect(repo.tasks.get(task.id)).toMatchObject({
    enabled: false,
    sessionId: 'session-1',
    lastRunAt: 1_000,
    nextRunAt: undefined,
  })
  expect(notify).toHaveBeenCalledWith({ title: 'KklyeeNook', body: 'Daily project check 已完成' })
})

test('reuses a configured session and advances recurring tasks', async () => {
  const { scheduler, repo, agentService, notify } = setup()
  const task = await scheduler.create({
    title: 'Weekly check',
    prompt: 'Check the project',
    schedule: { type: 'daily', time: '00:00' },
    sessionId: 'existing-session',
  })
  await repo.save({ ...task, nextRunAt: 999 })

  await scheduler.runDueTasks(1_000)

  expect(agentService.createSession).not.toHaveBeenCalled()
  expect(agentService.startRun).toHaveBeenCalledWith('existing-session', expect.anything())
  expect(repo.tasks.get(task.id)).toMatchObject({
    enabled: true,
    lastRunAt: 1_000,
    nextRunAt: expect.any(Number),
  })
  expect(repo.tasks.get(task.id)!.nextRunAt).toBeGreaterThan(1_000)
  expect(notify).toHaveBeenCalledWith({ title: 'KklyeeNook', body: 'Weekly check 已完成' })
})

test('does not run a disabled task', async () => {
  const { scheduler, agentService, notify } = setup()
  const task = await scheduler.create({
    title: 'Disabled task',
    prompt: 'Do nothing',
    schedule: { type: 'once', runAt: 999 },
    enabled: false,
  })

  await scheduler.runDueTasks(1_000)

  expect(agentService.startRun).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
  expect(task.nextRunAt).toBeUndefined()
})

test('notifies when the shared AgentService run fails', async () => {
  const { scheduler, repo, notify } = setup()
  const task = await createDueTask(scheduler)
  const schedulerWithFailure = new ScheduledTaskScheduler(
    repo,
    {
      createSession: vi.fn(async () => ({ id: 'session-1' })),
      startRun: vi.fn(() => ({
        run: { id: 'run-1' },
        completion: Promise.resolve({ ...completedRun('session-1'), status: 'failed' as const }),
      })),
    } as unknown as AgentService,
    {
      buildContext: async () => undefined,
      notify,
      now: () => 1_000,
    },
  )

  await schedulerWithFailure.runDueTasks(1_000)

  expect(notify).toHaveBeenCalledWith({ title: 'KklyeeNook', body: `${task.title} 执行失败` })
})
