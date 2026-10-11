import { and, asc, eq, isNull } from 'drizzle-orm'
import type { BotProfile } from '@kklyeenook/shared/bot/bot'
import type { Database } from '../client'
import { bots } from '../schema/bots'

export interface BotRepo {
  list(): Promise<BotProfile[]>
  get(id: string): Promise<BotProfile | undefined>
  insert(bot: BotProfile): Promise<void>
  save(bot: BotProfile): Promise<void>
  remove(id: string): Promise<void>
}

export class DrizzleBotRepo implements BotRepo {
  constructor(private readonly db: Database) {}

  async list() {
    return this.db.select().from(bots).where(isNull(bots.deletedAt)).orderBy(asc(bots.createdAt))
  }

  async get(id: string) {
    return (await this.db.select().from(bots).where(and(eq(bots.id, id), isNull(bots.deletedAt))).limit(1))[0]
  }

  async insert(bot: BotProfile) {
    await this.db.insert(bots).values(bot).onConflictDoNothing()
  }

  async save(bot: BotProfile) {
    await this.db.update(bots).set(bot).where(and(eq(bots.id, bot.id), isNull(bots.deletedAt)))
  }

  async remove(id: string) {
    await this.db.update(bots).set({ deletedAt: Date.now() }).where(eq(bots.id, id))
  }
}
