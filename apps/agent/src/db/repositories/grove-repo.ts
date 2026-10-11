import { asc, eq } from 'drizzle-orm'
import type { BotMessage, BotTask } from '@kklyeenook/shared/bot/grove'
import type { Database } from '../client'
import { botMessages, botTasks } from '../schema/grove'

export interface GroveRepo {
  messages(): Promise<BotMessage[]>
  tasks(): Promise<BotTask[]>
  getTask(id: string): Promise<BotTask | undefined>
  putMessage(message: BotMessage): Promise<void>
  putTask(task: BotTask): Promise<void>
}

export class DrizzleGroveRepo implements GroveRepo {
  constructor(private readonly db: Database) {}

  async messages(): Promise<BotMessage[]> {
    return (await this.db.select().from(botMessages).orderBy(asc(botMessages.createdAt))).map(
      ({ correlationId, ...message }) => ({
        ...message,
        correlationId: correlationId ?? undefined,
      }),
    )
  }

  async tasks(): Promise<BotTask[]> {
    return (await this.db.select().from(botTasks).orderBy(asc(botTasks.createdAt))).map(taskRecord)
  }

  async getTask(id: string): Promise<BotTask | undefined> {
    const row = (await this.db.select().from(botTasks).where(eq(botTasks.id, id)).limit(1))[0]
    return row ? taskRecord(row) : undefined
  }

  async putMessage(message: BotMessage) {
    await this.db.insert(botMessages).values(message).onConflictDoNothing()
  }

  async putTask(task: BotTask) {
    await this.db
      .insert(botTasks)
      .values(task)
      .onConflictDoUpdate({ target: botTasks.id, set: task })
  }
}

function taskRecord(row: typeof botTasks.$inferSelect): BotTask {
  return {
    ...row,
    result: row.result ?? undefined,
    targetThreadId: row.targetThreadId ?? undefined,
    submissionId: row.submissionId ?? undefined,
    parentTaskId: row.parentTaskId ?? undefined,
  }
}
