import type { Context } from '@earendil-works/chord'
import { defineDoc, type AgentChange, type SubmissionId } from '@earendil-works/pi-durable'
import type { AgentSessionRepo } from '../db/repositories/agentSessionRepo'
import type { PermissionMode } from '@/shared/approval/permission'
import { AgentEngine } from './agent-engine'
import type { ContextInput, AgentInputs } from './inputs'

export type CreateConversation = {
  threadId: string
  title?: string
  workspaceId?: string | null
  permissionMode?: PermissionMode
  initialize?: Parameters<AgentEngine['create']>[3]
  agent: AgentChange
}

export const creationRecord = defineDoc<{
  id: string
  title: string
  workspaceId: string | null
  permissionMode: PermissionMode
  createdAt: number
  updatedAt: number
  archived: boolean
}>({
  kind: 'nook.conversation-created',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({
    id: '',
    title: '',
    workspaceId: null,
    permissionMode: 'read-only',
    createdAt: 0,
    updatedAt: 0,
    archived: false,
  }),
})

export class ConversationService {
  constructor(
    private readonly engine: AgentEngine,
    private readonly sessions: AgentSessionRepo,
    private readonly inputs?: AgentInputs,
  ) {}

  async create(input: CreateConversation, context: Context) {
    const existing = await this.sessions.findById(input.threadId)
    const links = await this.engine.links(context)
    if (existing) {
      if (!Object.hasOwn(links, existing.id))
        throw new Error('Historical conversation is read-only')
      await this.engine.conversation(existing.id, context)
      return existing
    }
    const now = Date.now()
    const initialRecord = {
      id: input.threadId,
      title: input.title ?? '新会话',
      workspaceId: input.workspaceId ?? null,
      permissionMode: input.permissionMode ?? 'read-only',
      createdAt: now,
      updatedAt: now,
      archived: false,
    }
    const conversationId = await this.engine.create(
      input.threadId,
      input.agent,
      context,
      async (tx, id) => {
        Object.assign(await tx.doc(creationRecord, id), initialRecord)
        await input.initialize?.(tx, id)
      },
    )
    const record = await this.engine.harness.snapshot(creationRecord, conversationId, context)
    if (!record) throw new Error('Conversation creation metadata not found')
    await this.sessions.save(record)
    return record
  }

  async list(context: Context) {
    const links = await this.engine.links(context)
    return (await this.sessions.findAll()).map((record) => ({
      ...record,
      historical: !Object.hasOwn(links, record.id),
    }))
  }

  async live(context: Context) {
    const links = await this.engine.links(context)
    return (await this.sessions.findAll()).filter((record) => Object.hasOwn(links, record.id))
  }

  async get(threadId: string, context: Context) {
    const record = await this.sessions.findById(threadId)
    if (!record) throw new Error('Conversation not found')
    const links = await this.engine.links(context)
    if (!Object.hasOwn(links, record.id)) return { ...record, historical: true }
    await this.engine.conversation(threadId, context)
    return record
  }

  async getLive(threadId: string, context: Context) {
    const record = await this.sessions.findById(threadId)
    if (!record) throw new Error('Conversation not found')
    await this.engine.conversation(threadId, context)
    return record
  }

  async update(threadId: string, update: { title?: string; archived?: boolean; permissionMode?: PermissionMode }, context: Context) {
    const record = await this.get(threadId, context)
    const next = { ...record, ...update, updatedAt: Math.max(Date.now(), record.updatedAt + 1) }
    await this.sessions.save(next)
    if ('historical' in record && record.historical) return next
    const conversation = await this.engine.conversation(threadId, context)
    await conversation.commit(async (tx) => {
      Object.assign(await tx.doc(creationRecord, conversation.id), next)
    }, context)
    return next
  }

  async archive(threadId: string, archived: boolean, context: Context) {
    return this.update(threadId, { archived }, context)
  }

  async tombstone(threadId: string, context: Context) {
    const record = await this.get(threadId, context)
    if (!('historical' in record && record.historical)) await this.cancel(threadId, context)
    return this.archive(threadId, true, context)
  }

  async submit(threadId: string, input: ContextInput, context: Context) {
    if (!input.requestId.trim()) throw new Error('A stable request ID is required')
    await this.get(threadId, context)
    const conversation = await this.engine.conversation(threadId, context)
    if (!this.inputs && (input.contextAttachmentIds?.length || input.skillIds?.length))
      throw new Error('Input context service is not configured')
    const submission = this.inputs
      ? await this.inputs.submit(conversation, input, context)
      : await conversation.submit(input, context)
    return { accepted: true as const, conversationId: conversation.id, submissionId: submission.id }
  }

  async status(threadId: string, submissionId: SubmissionId, context: Context) {
    await this.get(threadId, context)
    return (await this.engine.submission(threadId, submissionId, context)).status(context)
  }

  async withdraw(threadId: string, submissionId: SubmissionId, context: Context) {
    await this.get(threadId, context)
    return (await this.engine.submission(threadId, submissionId, context)).abort(context)
  }

  async cancel(threadId: string, context: Context) {
    await this.get(threadId, context)
    await (await this.engine.conversation(threadId, context)).abort(context)
  }

  async snapshot(threadId: string, context: Context) {
    await this.get(threadId, context)
    const stream = await this.engine.watch(threadId, context)
    try {
      return stream.snapshot
    } finally {
      await stream.stop()
    }
  }
}
