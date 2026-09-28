import { randomUUID } from 'node:crypto'

import type { AgentBackendNotification } from '@/shared/agentBackend'
import type { AgentRuntimeInput } from '@/main/agent/agentRuntime'
import type { AgentService } from '@/main/agent/agentService'
import type { AgentRunContext } from '@/main/context/contextBuilder'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  UpdateScheduledTaskInput,
} from '@/shared/scheduler/scheduledTask'
import { getNextScheduledTaskRunAt, validateScheduledTaskSchedule } from './schedule'
import type { ScheduledTaskRepo } from '@/main/db/repositories/scheduledTaskRepo'

export interface ScheduledTaskSchedulerOptions {
  buildContext: () => Promise<AgentRunContext | undefined>
  projectSession?: (sessionId: string) => Promise<void>
  notify?: (notification: AgentBackendNotification) => void
  now?: () => number
  intervalMs?: number
}

export class ScheduledTaskScheduler {
  private readonly now: () => number
  private readonly intervalMs: number
  private readonly buildContext: () => Promise<AgentRunContext | undefined>
  private readonly projectSession: ((sessionId: string) => Promise<void>) | undefined
  private readonly notify: (notification: AgentBackendNotification) => void
  private readonly running = new Set<string>()
  private timer: ReturnType<typeof setInterval> | undefined
  private checking = false

  constructor(
    private readonly repo: ScheduledTaskRepo,
    private readonly agentService: AgentService,
    options: ScheduledTaskSchedulerOptions,
  ) {
    this.now = options.now ?? (() => Date.now())
    this.intervalMs = options.intervalMs ?? 1_000
    this.buildContext = options.buildContext
    this.projectSession = options.projectSession
    this.notify = options.notify ?? (() => undefined)
  }

  async start(): Promise<void> {
    if (this.timer) return

    const tasks = await this.repo.findEnabled()
    for (const task of tasks) {
      if (task.nextRunAt !== undefined) continue
      await this.repo.save({
        ...task,
        nextRunAt: getNextScheduledTaskRunAt(task.schedule, this.now()),
        updatedAt: this.now(),
      })
    }

    this.timer = setInterval(() => {
      void this.runDueTasks().catch((error) => {
        console.error('[ScheduledTaskScheduler] failed to check tasks:', error)
      })
    }, this.intervalMs)
    this.timer.unref?.()
    void this.runDueTasks().catch((error) => {
      console.error('[ScheduledTaskScheduler] failed to run startup tasks:', error)
    })
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  async list(): Promise<ScheduledTask[]> {
    return this.repo.findAll()
  }

  async create(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    validateTaskInput(input.title, input.prompt, input.schedule, input.skillIds)
    const now = this.now()
    const enabled = input.enabled ?? true
    const task: ScheduledTask = {
      id: randomUUID(),
      title: input.title.trim(),
      prompt: input.prompt.trim(),
      schedule: input.schedule,
      enabled,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.skillIds?.length ? { skillIds: [...input.skillIds] } : {}),
      ...(enabled ? { nextRunAt: getNextScheduledTaskRunAt(input.schedule, now) } : {}),
      createdAt: now,
      updatedAt: now,
    }
    await this.repo.save(task)
    return task
  }

  async update(id: string, input: UpdateScheduledTaskInput): Promise<ScheduledTask> {
    const existing = await this.requireTask(id)
    const schedule = input.schedule ?? existing.schedule
    const title = input.title ?? existing.title
    const prompt = input.prompt ?? existing.prompt
    const enabled = input.enabled ?? existing.enabled
    validateTaskInput(title, prompt, schedule, input.skillIds ?? existing.skillIds)

    const now = this.now()
    const task: ScheduledTask = {
      ...existing,
      title: title.trim(),
      prompt: prompt.trim(),
      schedule,
      enabled,
      ...(input.sessionId === null
        ? {}
        : input.sessionId !== undefined
          ? { sessionId: input.sessionId }
          : existing.sessionId
            ? { sessionId: existing.sessionId }
            : {}),
      ...(input.sessionId === null ? { sessionId: undefined } : {}),
      ...(input.skillIds !== undefined
        ? input.skillIds.length
          ? { skillIds: [...input.skillIds] }
          : { skillIds: undefined }
        : existing.skillIds?.length
          ? { skillIds: existing.skillIds }
          : {}),
      ...(input.schedule !== undefined || input.enabled !== undefined
        ? enabled
          ? { nextRunAt: getNextScheduledTaskRunAt(schedule, now) }
          : { nextRunAt: undefined }
        : {}),
      updatedAt: now,
    }
    await this.repo.save(task)
    return task
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    const existing = await this.requireTask(id)
    const now = this.now()
    const task: ScheduledTask = {
      ...existing,
      enabled,
      ...(enabled ? { nextRunAt: getNextScheduledTaskRunAt(existing.schedule, now) } : { nextRunAt: undefined }),
      updatedAt: now,
    }
    await this.repo.save(task)
    return task
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id)
  }

  async runDueTasks(now = this.now()): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const tasks = await this.repo.findEnabled()
      const dueTasks = tasks.filter(
        (task) =>
          task.nextRunAt !== undefined &&
          task.nextRunAt <= now &&
          !this.running.has(task.id),
      )
      await Promise.all(dueTasks.map((task) => this.execute(task)))
    } finally {
      this.checking = false
    }
  }

  private async execute(task: ScheduledTask): Promise<void> {
    this.running.add(task.id)
    const startedAt = this.now()
    let title = task.title
    try {
      const current = await this.repo.findById(task.id)
      if (!current?.enabled || current.nextRunAt === undefined || current.nextRunAt > startedAt) return
      title = current.title
      await this.repo.save({ ...current, lastRunAt: startedAt, updatedAt: startedAt })

      const sessionId = await this.ensureSession(current)
      const context = await this.buildContext()
      const input: AgentRuntimeInput = {
        prompt: current.prompt,
        ...(context ? { context } : {}),
        ...(current.skillIds?.length ? { skillIds: current.skillIds } : {}),
        scheduledTaskId: current.id,
      }
      const finalRun = await this.agentService.startRun(sessionId, input).completion
      await this.projectSession?.(sessionId)
      this.sendNotification(title, finalRun.status === 'completed')
    } catch (error) {
      console.error('[ScheduledTaskScheduler] task failed:', { taskId: task.id, error })
      this.sendNotification(title, false)
    } finally {
      await this.finish(task.id, startedAt)
      this.running.delete(task.id)
    }
  }

  private async ensureSession(task: ScheduledTask): Promise<string> {
    if (task.sessionId) return task.sessionId

    const session = await this.agentService.createSession(task.title)
    const current = await this.repo.findById(task.id)
    if (current && !current.sessionId) {
      await this.repo.save({ ...current, sessionId: session.id, updatedAt: this.now() })
    }
    return session.id
  }

  private async finish(id: string, startedAt: number): Promise<void> {
    const current = await this.repo.findById(id)
    if (!current) return
    const updatedAt = this.now()
    if (!current.enabled) {
      await this.repo.save({ ...current, nextRunAt: undefined, updatedAt })
      return
    }
    if (current.schedule.type === 'once') {
      await this.repo.save({
        ...current,
        enabled: false,
        lastRunAt: current.lastRunAt ?? startedAt,
        nextRunAt: undefined,
        updatedAt,
      })
      return
    }
    await this.repo.save({
      ...current,
      lastRunAt: current.lastRunAt ?? startedAt,
      nextRunAt: getNextScheduledTaskRunAt(current.schedule, updatedAt),
      updatedAt,
    })
  }

  private async requireTask(id: string): Promise<ScheduledTask> {
    const task = await this.repo.findById(id)
    if (!task) throw new Error(`ScheduledTask not found: ${id}`)
    return task
  }

  private sendNotification(title: string, success: boolean): void {
    try {
      this.notify({ title: 'KklyeeNook', body: `${title} ${success ? '已完成' : '执行失败'}` })
    } catch (error) {
      console.error('[ScheduledTaskScheduler] notification failed:', error)
    }
  }
}

function validateTaskInput(
  title: string,
  prompt: string,
  schedule: CreateScheduledTaskInput['schedule'],
  skillIds: string[] | undefined,
): void {
  if (!title.trim()) throw new Error('Scheduled task title is required')
  if (!prompt.trim()) throw new Error('Scheduled task prompt is required')
  validateScheduledTaskSchedule(schedule)
  if (skillIds?.some((id) => !id.trim())) throw new Error('Scheduled task skill IDs are invalid')
}
