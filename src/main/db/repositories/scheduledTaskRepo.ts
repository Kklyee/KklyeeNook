import { asc, desc, eq } from 'drizzle-orm'

import type { Database } from '../client'
import { scheduledTasks, type ScheduledTaskRow } from '../schema/scheduledTasks'
import type { ScheduledTask } from '@/shared/scheduler/scheduledTask'

export interface ScheduledTaskRepo {
  findAll(): Promise<ScheduledTask[]>
  findEnabled(): Promise<ScheduledTask[]>
  findById(id: string): Promise<ScheduledTask | undefined>
  save(task: ScheduledTask): Promise<void>
  delete(id: string): Promise<void>
}

function toScheduledTask(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    schedule: row.schedule,
    enabled: row.enabled,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.skillIds.length ? { skillIds: row.skillIds } : {}),
    ...(row.lastRunAt !== null ? { lastRunAt: row.lastRunAt } : {}),
    ...(row.nextRunAt !== null ? { nextRunAt: row.nextRunAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class DrizzleScheduledTaskRepo implements ScheduledTaskRepo {
  constructor(private readonly db: Database) {}

  async findAll(): Promise<ScheduledTask[]> {
    const rows = await this.db.select().from(scheduledTasks).orderBy(desc(scheduledTasks.createdAt))
    return rows.map(toScheduledTask)
  }

  async findEnabled(): Promise<ScheduledTask[]> {
    const rows = await this.db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.enabled, true))
      .orderBy(asc(scheduledTasks.nextRunAt), asc(scheduledTasks.createdAt))
    return rows.map(toScheduledTask)
  }

  async findById(id: string): Promise<ScheduledTask | undefined> {
    const rows = await this.db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).limit(1)
    return rows[0] ? toScheduledTask(rows[0]) : undefined
  }

  async save(task: ScheduledTask): Promise<void> {
    await this.db
      .insert(scheduledTasks)
      .values({
        id: task.id,
        title: task.title,
        prompt: task.prompt,
        schedule: task.schedule,
        enabled: task.enabled,
        sessionId: task.sessionId ?? null,
        skillIds: task.skillIds ?? [],
        lastRunAt: task.lastRunAt ?? null,
        nextRunAt: task.nextRunAt ?? null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })
      .onConflictDoUpdate({
        target: scheduledTasks.id,
        set: {
          title: task.title,
          prompt: task.prompt,
          schedule: task.schedule,
          enabled: task.enabled,
          sessionId: task.sessionId ?? null,
          skillIds: task.skillIds ?? [],
          lastRunAt: task.lastRunAt ?? null,
          nextRunAt: task.nextRunAt ?? null,
          updatedAt: task.updatedAt,
        },
      })
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(scheduledTasks).where(eq(scheduledTasks.id, id))
  }
}
