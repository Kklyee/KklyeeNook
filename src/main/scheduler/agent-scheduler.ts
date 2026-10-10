import { randomUUID } from 'node:crypto'

import type { Context } from '@earendil-works/chord'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  defineDoc,
  defineExtension,
  defineTask,
  type ConversationId,
  type Extension,
  type InputSubmissionDraft,
  type TaskId,
  type TaskRuntime,
} from '@earendil-works/pi-durable'
import type { AgentHost } from '@/main/agent/agent-host'
import type { ScheduledTaskRepo } from '@/main/db/repositories/scheduledTaskRepo'
import type { AgentBackendNotification } from '@/shared/agentBackend'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  UpdateScheduledTaskInput,
} from '@/shared/scheduler/scheduledTask'
import { getNextScheduledTaskRunAt, validateScheduledTaskSchedule } from './schedule'

type SchedulerDoc = {
  schedules: Record<string, { version: number; taskId?: number }>
}

type AgentScheduleInput = {
  id: string
  version: number
}

type AgentScheduleState =
  | { phase: 'wait'; version: number }
  | { phase: 'dispatch'; version: number; dueAt: number; requestId: string }
  | {
      phase: 'finish'
      version: number
      dueAt: number
      admittedAt: number
      requestId: string
      threadId: string
      submissionId: number
    }

type AgentScheduleResult = {
  disposition: 'completed' | 'failed' | 'stale' | 'aborted'
}

type AgentScheduleRuntime = TaskRuntime<
  AgentScheduleInput,
  AgentScheduleState,
  AgentScheduleResult,
  object
>

export const agentSchedulerDoc = defineDoc<SchedulerDoc>({
  kind: 'nook.scheduler',
  version: 1,
  scope: 'session',
  initial: () => ({ schedules: {} }),
})

const controlThreadId = 'scheduled:__scheduler'

export class AgentScheduler {
  readonly extension: Extension
  private host: AgentHost | undefined
  private readonly notify: (notification: AgentBackendNotification) => void
  private readonly agentTask
  private closed = false

  constructor(
    private readonly repo: ScheduledTaskRepo,
    notify?: (notification: AgentBackendNotification) => void,
  ) {
    this.notify = notify ?? (() => undefined)
    this.agentTask = defineTask<
      AgentScheduleInput,
      AgentScheduleState,
      AgentScheduleResult
    >({
      name: 'nook.scheduled-task',
      version: 1,
      initial: (input) => ({ phase: 'wait', version: input.version }),
      phases: {
        wait: (task, runtime, context) => this.wait(task, runtime, context),
        dispatch: (task, runtime, context) => this.dispatch(task, runtime, context),
        finish: (task, runtime, context) => this.finish(task, runtime, context),
      },
      abort: async (_task, runtime, context) => {
        await runtime.commit(
          async (tx, current) => {
            const doc = await tx.doc(agentSchedulerDoc)
            const record = doc.schedules[current.input.id]
            if (record?.taskId === current.id) delete doc.schedules[current.input.id]
            return {
              status: 'terminal',
              outcome: { status: 'aborted', reason: 'aborted', result: { disposition: 'aborted' } },
            }
          },
          context,
        )
      },
    })
    this.extension = defineExtension({ name: 'nook.scheduler', tasks: [this.agentTask] })
  }

  connect(host: AgentHost): void {
    if (this.host && this.host !== host) throw new Error('Durable scheduler already connected')
    this.host = host
  }

  async restore(context: Context): Promise<void> {
    const tasks = await this.repo.findAll()
    for (const task of tasks) await this.reconcile(task, context)
    const ids = new Set(tasks.map((task) => task.id))
    const doc = await this.requireHost().engine.harness.snapshot(agentSchedulerDoc, context)
    for (const id of Object.keys(doc?.schedules ?? {})) {
      if (!ids.has(id)) await this.retire(id, context)
    }
  }

  async list(): Promise<ScheduledTask[]> {
    return Promise.all((await this.repo.findAll()).map(async (task) => {
      if (!this.host || !task.sessionId) return task
      const target = await this.host.conversations.get(task.sessionId, BACKGROUND_CONTEXT)
      return 'historical' in target && target.historical ? { ...task, blockedReason: 'historical-conversation' as const } : task
    }))
  }

  async create(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    validateTaskInput(input.title, input.prompt, input.schedule, input.skillIds)
    if (input.enabled !== false) await this.assertTarget(input.sessionId)
    const now = Date.now()
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
    await this.reconcile(task, BACKGROUND_CONTEXT)
    return task
  }

  async update(id: string, input: UpdateScheduledTaskInput): Promise<ScheduledTask> {
    const existing = await this.requireTask(id)
    const schedule = input.schedule ?? existing.schedule
    const title = input.title ?? existing.title
    const prompt = input.prompt ?? existing.prompt
    const enabled = input.enabled ?? existing.enabled
    validateTaskInput(title, prompt, schedule, input.skillIds ?? existing.skillIds)
    if (enabled) await this.assertTarget(input.sessionId === null ? undefined : input.sessionId ?? existing.sessionId)
    const now = timestamp(existing.updatedAt)
    const task: ScheduledTask = {
      ...existing,
      title: title.trim(),
      prompt: prompt.trim(),
      schedule,
      enabled,
      sessionId:
        input.sessionId === null
          ? undefined
          : input.sessionId !== undefined
            ? input.sessionId
            : existing.sessionId,
      skillIds:
        input.skillIds !== undefined
          ? input.skillIds.length
            ? [...input.skillIds]
            : undefined
          : existing.skillIds?.length
            ? [...existing.skillIds]
            : undefined,
      nextRunAt:
        input.schedule !== undefined || input.enabled !== undefined
          ? enabled
            ? getNextScheduledTaskRunAt(schedule, now)
            : undefined
          : existing.nextRunAt,
      updatedAt: now,
    }
    await this.repo.save(task)
    await this.reconcile(task, BACKGROUND_CONTEXT)
    return task
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    const existing = await this.requireTask(id)
    if (enabled) await this.assertTarget(existing.sessionId)
    const now = timestamp(existing.updatedAt)
    const task: ScheduledTask = {
      ...existing,
      enabled,
      nextRunAt: enabled ? getNextScheduledTaskRunAt(existing.schedule, now) : undefined,
      updatedAt: now,
    }
    await this.repo.save(task)
    await this.reconcile(task, BACKGROUND_CONTEXT)
    return task
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id)
    await this.retire(id, BACKGROUND_CONTEXT)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  private async wait(
    task: { input: AgentScheduleInput; state: { checkpoint: Extract<AgentScheduleState, { phase: 'wait' }> } },
    runtime: AgentScheduleRuntime,
    context: Context,
  ): Promise<void> {
    const current = await this.repo.findById(task.input.id)
    const version = task.state.checkpoint.version
    if (!current || !current.enabled || current.updatedAt !== version || current.nextRunAt === undefined) {
      await this.complete(runtime, 'stale', context)
      return
    }
    if (current.nextRunAt > runtime.now()) await runtime.sleep(current.nextRunAt, context)
    const dueAt = current.nextRunAt
    await runtime.commit(
      () => ({
        status: 'running',
        checkpoint: {
          phase: 'dispatch',
          version,
          dueAt,
          requestId: occurrenceRequestId(current.id, version, dueAt),
        },
      }),
      context,
    )
  }

  private async dispatch(
    task: { input: AgentScheduleInput; state: { checkpoint: Extract<AgentScheduleState, { phase: 'dispatch' }> } },
    runtime: AgentScheduleRuntime,
    context: Context,
  ): Promise<void> {
    const checkpoint = task.state.checkpoint
    const current = await this.repo.findById(task.input.id)
    if (
      !current ||
      !current.enabled ||
      current.updatedAt !== checkpoint.version ||
      current.nextRunAt !== checkpoint.dueAt
    ) {
      await this.complete(runtime, 'stale', context)
      return
    }
    try {
      const threadId = current.sessionId ?? scheduledThreadId(current.id)
      if (current.sessionId) {
        const target = await this.requireHost().conversations.get(threadId, context)
        if ('historical' in target && target.historical) {
          await this.pauseHistorical(current)
          await this.complete(runtime, 'stale', context)
          return
        }
      }
      else await this.requireHost().create({ threadId, title: current.title }, context)
      const conversation = await this.requireHost().engine.conversation(threadId, context)
      const handle = await runtime.conversation(conversation.id, context)
      if (!handle) throw new Error('Scheduled conversation not found')
      const admittedAt = runtime.now()
      const submission = await this.requireHost().inputs.submit(
        handle,
        this.submissionInput(current, checkpoint.requestId),
        context,
      )
      await runtime.commit(
        () => ({
          status: 'running',
          checkpoint: {
            phase: 'finish',
            version: checkpoint.version,
            dueAt: checkpoint.dueAt,
            admittedAt,
            requestId: checkpoint.requestId,
            threadId,
            submissionId: submission.id as number,
          },
        }),
        context,
      )
    } catch (error) {
      context.abortSignal?.throwIfAborted()
      runtime.report(error)
      await this.finishProjection(current.id, checkpoint.version, checkpoint.dueAt, runtime.now(), false)
      this.sendNotification(current.title, false)
      await this.complete(runtime, 'failed', context)
    }
  }

  private async finish(
    task: { input: AgentScheduleInput; state: { checkpoint: Extract<AgentScheduleState, { phase: 'finish' }> } },
    runtime: AgentScheduleRuntime,
    context: Context,
  ): Promise<void> {
    const checkpoint = task.state.checkpoint
    const current = await this.repo.findById(task.input.id)
    if (!current || current.updatedAt !== checkpoint.version) {
      await this.complete(runtime, 'stale', context)
      return
    }
    const conversation = await this.requireHost().engine.conversation(checkpoint.threadId, context)
    const handle = await runtime.conversation(conversation.id, context)
    if (!handle) throw new Error('Scheduled conversation not found')
    const submission = await this.requireHost().inputs.submit(
      handle,
      this.submissionInput(current, checkpoint.requestId),
      context,
    )
    if ((submission.id as number) !== checkpoint.submissionId) {
      throw new Error('Scheduled submission request ID resolved to a different submission')
    }
    const settled = await submission.wait(context)
    const success = settled.status === 'done'
    const projection = await this.finishProjection(
      current.id,
      checkpoint.version,
      checkpoint.dueAt,
      checkpoint.admittedAt,
      success,
    )
    this.sendNotification(current.title, success)
    await runtime.commit(
      async (tx, live) => {
        const doc = await tx.doc(agentSchedulerDoc)
        if (projection?.enabled && projection.nextRunAt !== undefined) {
          doc.schedules[current.id] = { version: projection.updatedAt, taskId: live.id as number }
          return { status: 'running', checkpoint: { phase: 'wait', version: projection.updatedAt } }
        }
        const record = doc.schedules[current.id]
        if (record?.taskId === live.id) delete doc.schedules[current.id]
        return {
          status: 'terminal',
          outcome: { status: 'completed', result: { disposition: success ? 'completed' : 'failed' } },
        }
      },
      context,
    )
  }

  private async reconcile(task: ScheduledTask, context: Context): Promise<void> {
    if (this.closed || !this.host) return
    let current = task
    if (current.sessionId) {
      const target = await this.host.conversations.get(current.sessionId, context)
      if ('historical' in target && target.historical) {
        if (current.enabled) await this.pauseHistorical(current)
        await this.retire(current.id, context)
        return
      }
    }
    if (current.enabled && current.nextRunAt === undefined) {
      const now = timestamp(current.updatedAt)
      current = {
        ...current,
        nextRunAt: getNextScheduledTaskRunAt(current.schedule, now),
        updatedAt: now,
      }
      await this.repo.save(current)
    }
    if (!current.enabled || current.nextRunAt === undefined) {
      await this.retire(current.id, context)
      return
    }
    const harness = this.requireHost().engine.harness
    const previous = await harness.snapshot(agentSchedulerDoc, context)
    const previousTaskId = previous?.schedules[current.id]?.taskId
    const control = await this.ensureControlConversation(context)
    const taskId = await harness.commit(async (tx) => {
      const doc = await tx.doc(agentSchedulerDoc)
      const record = doc.schedules[current.id]
      if (record?.version === current.updatedAt && record.taskId !== undefined) {
        const existing = await tx.task(record.taskId as TaskId<AgentScheduleResult>)
        if (existing && existing.state.status !== 'terminal') return record.taskId
      }
      const created = await tx.createTask(
        this.agentTask,
        { id: current.id, version: current.updatedAt },
        {
          ownership: { kind: 'conversation' },
          conversationId: control,
          background: true,
        },
      )
      doc.schedules[current.id] = { version: current.updatedAt, taskId: created as number }
      return created as number
    }, context)
    if (previousTaskId !== undefined && previousTaskId !== taskId) await this.abort(previousTaskId, context)
  }

  private async retire(id: string, context: Context): Promise<void> {
    if (this.closed || !this.host) return
    const harness = this.requireHost().engine.harness
    const doc = await harness.snapshot(agentSchedulerDoc, context)
    const previousTaskId = doc?.schedules[id]?.taskId
    await harness.commit(async (tx) => {
      const doc = await tx.doc(agentSchedulerDoc)
      delete doc.schedules[id]
    }, context)
    if (previousTaskId !== undefined) await this.abort(previousTaskId, context)
  }

  private async ensureControlConversation(context: Context): Promise<ConversationId> {
    await this.requireHost().create({ threadId: controlThreadId, title: '计划任务调度' }, context)
    return (await this.requireHost().engine.conversation(controlThreadId, context)).id
  }

  private async abort(taskId: number, context: Context): Promise<void> {
    try {
      await this.requireHost().engine.harness.abortTask(taskId as TaskId<AgentScheduleResult>, context)
    } catch (error) {
      this.sendReport(error)
    }
  }

  private async finishProjection(
    id: string,
    version: number,
    dueAt: number,
    admittedAt: number,
    _success: boolean,
  ): Promise<ScheduledTask | undefined> {
    const current = await this.repo.findById(id)
    if (!current || current.updatedAt !== version) return undefined
    const now = timestamp(current.updatedAt)
    const lastRunAt = current.lastRunAt ?? admittedAt
    const task: ScheduledTask =
      current.schedule.type === 'once'
        ? {
            ...current,
            enabled: false,
            lastRunAt,
            nextRunAt: undefined,
            updatedAt: now,
          }
        : {
            ...current,
            lastRunAt,
            nextRunAt: getNextScheduledTaskRunAt(current.schedule, now) ?? dueAt,
            updatedAt: now,
          }
    await this.repo.save(task)
    return task
  }

  private submissionInput(task: ScheduledTask, requestId: string): InputSubmissionDraft & { requestId: string; skillIds?: readonly string[] } {
    return {
      type: 'input',
      requestId,
      content: task.prompt,
      ...(task.skillIds?.length ? { skillIds: task.skillIds } : {}),
    }
  }

  private async complete(
    runtime: AgentScheduleRuntime,
    disposition: AgentScheduleResult['disposition'],
    context: Context,
  ): Promise<void> {
    await runtime.commit(
      async (tx, current) => {
        const doc = await tx.doc(agentSchedulerDoc)
        const record = doc.schedules[current.input.id]
        if (record?.taskId === current.id) delete doc.schedules[current.input.id]
        return {
          status: 'terminal',
          outcome: { status: 'completed', result: { disposition } },
        }
      },
      context,
    )
  }

  private async requireTask(id: string): Promise<ScheduledTask> {
    const task = await this.repo.findById(id)
    if (!task) throw new Error(`ScheduledTask not found: ${id}`)
    return task
  }

  private async assertTarget(sessionId: string | undefined) {
    if (!this.host || !sessionId) return
    const target = await this.host.conversations.get(sessionId, BACKGROUND_CONTEXT)
    if ('historical' in target && target.historical) throw new Error('Historical conversation is read-only; continue it and select the new conversation before enabling this task')
  }

  private async pauseHistorical(task: ScheduledTask) {
    await this.repo.save({ ...task, enabled: false, nextRunAt: undefined, updatedAt: timestamp(task.updatedAt) })
    try {
      this.notify({ title: 'KklyeeNook', body: `${task.title} 已暂停：目标是只读历史会话。请明确继续历史会话后，编辑任务选择新会话并重新启用。` })
    } catch (error) { this.sendReport(error) }
  }

  private requireHost(): AgentHost {
    if (!this.host) throw new Error('Durable scheduler is not connected')
    return this.host
  }

  private sendNotification(title: string, success: boolean): void {
    try {
      this.notify({ title: 'KklyeeNook', body: `${title} ${success ? '已完成' : '执行失败'}` })
    } catch (error) {
      this.sendReport(error)
    }
  }

  private sendReport(error: unknown): void {
    console.error('[AgentScheduler] error:', error)
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

function scheduledThreadId(id: string): string {
  return `scheduled:${id}`
}

function occurrenceRequestId(id: string, version: number, dueAt: number): string {
  return `scheduled:${id}:${version}:${dueAt}`
}

function timestamp(after?: number): number {
  const now = Date.now()
  return after !== undefined && now <= after ? after + 1 : now
}
