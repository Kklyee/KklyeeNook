import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import { createRegistry, InboxDoc, type ConversationHandle } from '@earendil-works/pi-durable'
import type { AgentHost } from '@/main/agent/agent-host'
import { AgentEngine } from '@/main/agent/agent-engine'
import { AgentInputs, type ContextInput } from '@/main/agent/inputs'
import type { ScheduledTaskRepo } from '@/main/db/repositories/scheduledTaskRepo'
import type { AgentRunContext } from '@/main/context/contextBuilder'
import type { ScheduledTask } from '@/shared/scheduler/scheduledTask'
import { AgentScheduler, agentSchedulerDoc } from './agent-scheduler'

class MemoryScheduledTaskRepo implements ScheduledTaskRepo {
  readonly tasks = new Map<string, ScheduledTask>()

  async findAll() {
    return [...this.tasks.values()].map((task) => ({ ...task }))
  }

  async findEnabled() {
    return [...this.tasks.values()].filter((task) => task.enabled).map((task) => ({ ...task }))
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

type Skill = {
  id: string
  name: string
  description?: string
  instructions: string
  directory: string
}

class Skills {
  skills = new Map<string, Skill>()
  reload = vi.fn(async () => [...this.skills.values()])
  listSkills = vi.fn(() => [...this.skills.values()])
  getSkill = vi.fn((id: string) => this.skills.get(id))
}

let directory: string
const engines: AgentEngine[] = []
const context = () => withAbortSignal(AbortSignal.timeout(20_000), BACKGROUND_CONTEXT)
const model = { provider: 'faux', modelId: 'faux-1' }

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-scheduler-'))
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.allSettled(engines.splice(0).map((engine) => engine.close()))
  await rm(directory, { recursive: true, force: true })
})

async function openHarness(options: {
  path: string
  scheduler: AgentScheduler
  repo: MemoryScheduledTaskRepo
  faux?: ReturnType<typeof fauxProvider>
  skills?: Skills
  inputWrapper?: (real: AgentInputs) => AgentInputs
  now?: () => number
}) {
  const faux = options.faux ?? fauxProvider({ tokensPerSecond: 10_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const registry = createRegistry()
  const builder = {
    build: vi.fn(async (): Promise<AgentRunContext | undefined> => undefined),
  }
  const skills = options.skills ?? new Skills()
  const inputs = new AgentInputs(builder as never, skills as never, async () => undefined)
  registry.install(inputs.extension)
  registry.install(options.scheduler.extension)
  let engine!: AgentEngine
  let host!: AgentHost
  const makeHost = (current: AgentEngine): AgentHost => ({
    engine: current,
    inputs: options.inputWrapper?.(inputs) ?? inputs,
    conversations: {
      get: async (threadId: string, ctx) => {
        await current.conversation(threadId, ctx)
        return { id: threadId, title: threadId, createdAt: 1, updatedAt: 1, archived: false }
      },
    },
    create: async (input: { threadId: string; title?: string; permissionMode?: string }, ctx) => {
      await current.create(
        input.threadId,
        { model, extensions: [inputs.extension] },
        ctx,
      )
      return {
        id: input.threadId,
        title: input.title ?? '新会话',
        permissionMode: input.permissionMode ?? 'read-only',
        createdAt: 1,
        updatedAt: 1,
        archived: false,
      }
    },
  } as unknown as AgentHost)
  engine = await AgentEngine.open(
    options.path,
    {
      models,
      registry,
      settings: { retry: { enabled: false } },
      now: options.now,
      onReport: () => undefined,
    },
    context(),
    (initializing) => {
      engine = initializing
      inputs.connect(initializing.harness)
      host = makeHost(initializing)
      options.scheduler.connect(host)
    },
  )
  engines.push(engine)
  host = makeHost(engine)
  return { engine, faux, inputs, skills, builder, host }
}

async function dueTask(scheduler: AgentScheduler, input: Partial<Parameters<AgentScheduler['create']>[0]> = {}) {
  return scheduler.create({
    title: 'Daily project check',
    prompt: 'Check the project',
    schedule: { type: 'once', runAt: Date.now() - 1 },
    ...input,
  })
}

test('reopens a task interrupted after admission without duplicating the scheduled request', async () => {
  const repo = new MemoryScheduledTaskRepo()
  const path = join(directory, 'scheduler.sqlite')
  const admitted = Promise.withResolvers<void>()
  let first = true
  const scheduler = new AgentScheduler(repo)
  const { engine, faux } = await openHarness({
    path,
    scheduler,
    repo,
    inputWrapper: (real) => ({
      ...real,
      submit: async (conversation: ConversationHandle, input: ContextInput, ctx) => {
        const submission = await real.submit(conversation, input, ctx)
        if (first) {
          first = false
          admitted.resolve()
          await new Promise((_resolve, reject) => {
            ctx.abortSignal?.addEventListener('abort', () => reject(ctx.abortSignal?.reason), { once: true })
          })
        }
        return submission
      },
    } as AgentInputs),
  })
  faux.setResponses([fauxAssistantMessage('done')])
  const task = await dueTask(scheduler)
  await scheduler.restore(context())
  await admitted.promise
  await engine.close()
  engines.splice(engines.indexOf(engine), 1)

  const restoredScheduler = new AgentScheduler(repo)
  const restored = await openHarness({ path, scheduler: restoredScheduler, repo, faux })
  await restoredScheduler.restore(context())

  await vi.waitFor(async () => {
    expect((await repo.findById(task.id))?.enabled).toBe(false)
  })
  const conversation = await restored.engine.conversation(`scheduled:${task.id}`, context())
  const entries = await conversation.entries({ order: 'ascending' }, 20, undefined, context())
  expect(entries.items.filter((entry) => entry.kind === 'pi.user')).toHaveLength(1)
  expect(faux.state.callCount).toBe(1)
})

test('queues scheduled work behind a busy conversation and does not replace selected permissions', async () => {
  const repo = new MemoryScheduledTaskRepo()
  const scheduler = new AgentScheduler(repo)
  const path = join(directory, 'busy.sqlite')
  const { engine, faux } = await openHarness({
    path,
    scheduler,
    repo,
    faux: fauxProvider({ tokensPerSecond: 5, tokenSize: { min: 1, max: 1 } }),
  })
  faux.setResponses([fauxAssistantMessage('long '.repeat(200)), fauxAssistantMessage('scheduled done')])
  await engine.create('busy-thread', { model }, context())
  const busy = await engine.conversation('busy-thread', context())
  await busy.submit({ type: 'input', content: 'first', requestId: 'first' }, context())
  await vi.waitFor(() => expect(faux.state.callCount).toBe(1))
  const task = await dueTask(scheduler, { sessionId: 'busy-thread' })
  await scheduler.restore(context())

  await vi.waitFor(async () => {
    const inbox = await engine.harness.snapshot(InboxDoc, busy.id, context())
    expect(inbox?.items.some((item) => item.id > 0)).toBe(true)
  })
  expect((await repo.findById(task.id))?.sessionId).toBe('busy-thread')
})

test('disabled and deleted schedules remove stale durable work before it can submit', async () => {
  const repo = new MemoryScheduledTaskRepo()
  const scheduler = new AgentScheduler(repo)
  const path = join(directory, 'stale.sqlite')
  const { engine, faux } = await openHarness({ path, scheduler, repo })
  const task = await scheduler.create({
    title: 'Future',
    prompt: 'Do not run',
    schedule: { type: 'once', runAt: Date.now() + 60_000 },
  })
  await scheduler.restore(context())
  expect((await engine.harness.inspect(context())).tasks.length).toBeGreaterThan(0)
  await scheduler.setEnabled(task.id, false)
  await vi.waitFor(async () => expect((await engine.harness.inspect(context())).tasks).toEqual([]))

  const deleted = await scheduler.create({
    title: 'Delete',
    prompt: 'Do not run',
    schedule: { type: 'once', runAt: Date.now() + 60_000 },
  })
  await scheduler.delete(deleted.id)
  await vi.waitFor(async () => expect((await engine.harness.inspect(context())).tasks).toEqual([]))
  expect(faux.state.callCount).toBe(0)
})

test('preserves once daily and weekly projection semantics', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2024, 0, 1, 10, 0))
  const repo = new MemoryScheduledTaskRepo()
  const scheduler = new AgentScheduler(repo)
  const daily = await scheduler.create({
    title: 'Daily',
    prompt: 'Run daily',
    schedule: { type: 'daily', time: '09:00' },
  })
  const weekly = await scheduler.create({
    title: 'Weekly',
    prompt: 'Run weekly',
    schedule: { type: 'weekly', weekday: 1, time: '09:30' },
  })
  const once = await scheduler.create({
    title: 'Once',
    prompt: 'Run once',
    schedule: { type: 'once', runAt: Date.now() + 1_000 },
  })

  expect(daily.nextRunAt).toBe(new Date(2024, 0, 2, 9, 0).getTime())
  expect(weekly.nextRunAt).toBe(new Date(2024, 0, 8, 9, 30).getTime())
  expect(once.nextRunAt).toBe(Date.now() + 1_000)
})

test('restore reconciles missing projections and cleanup doc entries', async () => {
  const repo = new MemoryScheduledTaskRepo()
  const scheduler = new AgentScheduler(repo)
  const path = join(directory, 'cleanup.sqlite')
  const { engine } = await openHarness({ path, scheduler, repo })
  const now = Date.now()
  await repo.save({
    id: 'restored',
    title: 'Restored',
    prompt: 'Run',
    schedule: { type: 'once', runAt: now + 10_000 },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  })
  await scheduler.restore(context())
  expect((await repo.findById('restored'))?.nextRunAt).toBe(now + 10_000)
  expect((await engine.harness.snapshot(agentSchedulerDoc, context()))?.schedules.restored).toBeDefined()
  await repo.delete('restored')
  await scheduler.restore(context())
  expect((await engine.harness.snapshot(agentSchedulerDoc, context()))?.schedules.restored).toBeUndefined()
})
