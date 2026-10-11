import { asc, eq } from 'drizzle-orm'
import type { BotMessage, BotTask } from '@kklyeenook/shared/bot/grove'
import type { Database } from '../client'
import {
  botMessages,
  botTasks,
  networkIdentity,
  remoteContacts,
  socialInbox,
  socialOutbox,
} from '../schema/grove'
import type { NetworkBotIdentity, RelayEnvelope } from '@kklyeenook/shared/bot/social'
import type { SocialOutboxEntry } from '../../grove/remote-transport'

export interface GroveRepo {
  messages(): Promise<BotMessage[]>
  tasks(): Promise<BotTask[]>
  getTask(id: string): Promise<BotTask | undefined>
  putMessage(message: BotMessage): Promise<void>
  putTask(task: BotTask): Promise<void>
  identities(): Promise<NetworkBotIdentity[]>
  contacts(): Promise<NetworkBotIdentity[]>
  putIdentity(identity: NetworkBotIdentity): Promise<void>
  replaceContacts(contacts: NetworkBotIdentity[]): Promise<void>
  inbox(): Promise<{ envelope: RelayEnvelope; processedAt: number | null }[]>
  putInbox(envelope: RelayEnvelope): Promise<void>
  processInbox(id: string, error?: string): Promise<void>
  outbox(): Promise<SocialOutboxEntry[]>
  putOutbox(entry: SocialOutboxEntry): Promise<void>
}

export class DrizzleGroveRepo implements GroveRepo {
  constructor(private readonly db: Database) {}

  async messages(): Promise<BotMessage[]> {
    return (await this.db.select().from(botMessages).orderBy(asc(botMessages.createdAt))).map(
      ({ correlationId, remote, ...message }) => ({
        ...message,
        correlationId: correlationId ?? undefined,
        remote: remote ?? undefined,
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

  async identities() {
    return (await this.db.select().from(networkIdentity)).map((row) => row.identity)
  }
  async contacts() {
    return (await this.db.select().from(remoteContacts)).map((row) => row.identity)
  }
  async putIdentity(identity: NetworkBotIdentity) {
    await this.db
      .insert(networkIdentity)
      .values({ localBotId: identity.localBotId, identity })
      .onConflictDoUpdate({ target: networkIdentity.localBotId, set: { identity } })
  }
  async replaceContacts(contacts: NetworkBotIdentity[]) {
    await this.db.transaction(async (tx) => {
      await tx.delete(remoteContacts)
      if (contacts.length)
        await tx
          .insert(remoteContacts)
          .values(contacts.map((identity) => ({ networkId: identity.networkId, identity })))
    })
  }
  async inbox() {
    return (await this.db.select().from(socialInbox)).map(({ envelope, processedAt }) => ({
      envelope,
      processedAt,
    }))
  }
  async putInbox(envelope: RelayEnvelope) {
    await this.db
      .insert(socialInbox)
      .values({ id: envelope.message.id, envelope })
      .onConflictDoNothing()
  }
  async processInbox(id: string, error?: string) {
    await this.db
      .update(socialInbox)
      .set({ processedAt: Date.now(), error })
      .where(eq(socialInbox.id, id))
  }
  async outbox() {
    return (await this.db.select().from(socialOutbox)).map((row) => row.entry)
  }
  async putOutbox(entry: SocialOutboxEntry) {
    await this.db
      .insert(socialOutbox)
      .values({ id: entry.id, entry })
      .onConflictDoUpdate({ target: socialOutbox.id, set: { entry } })
  }
}

function taskRecord(row: typeof botTasks.$inferSelect): BotTask {
  return {
    ...row,
    result: row.result ?? undefined,
    targetThreadId: row.targetThreadId ?? undefined,
    submissionId: row.submissionId ?? undefined,
    parentTaskId: row.parentTaskId ?? undefined,
    remote: row.remote ?? undefined,
  }
}
