import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@earendil-works/chord'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  configure,
  defineDoc,
  Harness,
  type AgentChange,
  type ConversationId,
  type ConversationInit,
  type HarnessOptions,
  type SubmissionId,
  watchEvents,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'

const threadLinks = defineDoc<{ threads: Record<string, ConversationId> }>({
  kind: 'nook.thread-links',
  version: 1,
  scope: 'session',
  initial: () => ({ threads: {} }),
})

export class AgentEngine {
  private readonly watches = new Set<{ stop(): Promise<unknown> }>()
  private closing: Promise<void> | undefined

  private constructor(
    readonly harness: Harness,
    private readonly owner: DatabaseSync,
  ) {}

  static async open(
    databasePath: string,
    options: HarnessOptions,
    context: Context,
    initialize?: (engine: AgentEngine) => void | Promise<void>,
  ) {
    await mkdir(dirname(databasePath), { recursive: true })
    const owner = new DatabaseSync(`${databasePath}.owner.sqlite`, { timeout: 0 })
    try {
      owner.exec('BEGIN EXCLUSIVE')
      const storage = await openNodeSqliteStorage(databasePath)
      let harness: Harness
      try {
        harness = await Harness.open(storage, options, context)
      } catch (error) {
        await storage.close(BACKGROUND_CONTEXT)
        throw error
      }
      const engine = new AgentEngine(harness, owner)
      try {
        await initialize?.(engine)
        harness.resume()
        return engine
      } catch (error) {
        await harness.close(BACKGROUND_CONTEXT)
        throw error
      }
    } catch (error) {
      owner.close()
      throw error
    }
  }

  async create(threadId: string, agent: AgentChange, context: Context, init?: ConversationInit) {
    this.assertOpen()
    if (!threadId || ['__proto__', 'constructor', 'prototype'].includes(threadId)) {
      throw new Error('Invalid thread ID')
    }
    return this.harness.commit(async (tx) => {
      const links = await tx.doc(threadLinks)
      const existing = links.threads[threadId]
      if (existing !== undefined) return existing
      const conversation = await tx.createConversation({ ownership: { kind: 'ownerless' } })
      await configure(tx, conversation.id, {
        ...agent,
        extensions: agent.extensions ?? [],
        tools: agent.tools ?? [],
      })
      await init?.(tx, conversation.id)
      links.threads[threadId] = conversation.id
      return conversation.id
    }, context)
  }

  async links(context: Context) {
    this.assertOpen()
    return (await this.harness.snapshot(threadLinks, context))?.threads ?? {}
  }

  async conversation(threadId: string, context: Context) {
    const links = await this.links(context)
    const id = Object.hasOwn(links, threadId) ? links[threadId] : undefined
    const conversation = id === undefined ? undefined : await this.harness.conversation(id, context)
    if (!conversation) throw new Error('Durable conversation not found')
    return conversation
  }

  async ownerThread(conversationId: ConversationId, context: Context) {
    const links = await this.links(context)
    return this.harness.commit(async (tx) => {
      let id = conversationId
      while (true) {
        const threadId = Object.keys(links).find((key) => links[key] === id)
        if (threadId) return { threadId, conversationId: id }
        const record = await tx.conversation(id)
        if (!record?.owner) throw new Error('Conversation has no authorized business metadata')
        id = record.owner.conversationId
      }
    }, context)
  }

  async submission(threadId: string, submissionId: SubmissionId, context: Context) {
    const conversation = await this.conversation(threadId, context)
    const submission = await this.harness.submission(submissionId, context)
    if (!submission || (await submission.status(context)).conversationId !== conversation.id) {
      throw new Error('Submission not found in this conversation')
    }
    return submission
  }

  async watch(threadId: string, context: Context) {
    const conversation = await this.conversation(threadId, context)
    const stream = await watchEvents(this.harness, conversation.id, context)
    if (this.closing) {
      await stream.stop()
      throw new Error('Agent engine is closed')
    }
    this.watches.add(stream)
    void stream.closed.then(() => this.watches.delete(stream))
    return {
      ...stream,
      stop: async () => {
        try {
          return await stream.stop()
        } finally {
          this.watches.delete(stream)
        }
      },
    }
  }

  close() {
    this.closing ??= this.shutdown()
    return this.closing
  }

  private assertOpen() {
    if (this.closing) throw new Error('Agent engine is closed')
  }

  private async shutdown() {
    try {
      await Promise.all([...this.watches].map((watch) => watch.stop()))
    } finally {
      this.watches.clear()
      try {
        await this.harness.close(BACKGROUND_CONTEXT)
      } finally {
        this.owner.close()
      }
    }
  }
}
