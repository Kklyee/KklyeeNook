import type { Context } from '@earendil-works/chord'
import { defineDoc, type AgentChange, type SubmissionId } from '@earendil-works/pi-durable'
import type { AgentSessionRepo } from '../db/repositories/agent-session-repo'
import type { PermissionMode } from '@kklyeenook/shared/approval/permission'
import { AgentEngine } from './agent-engine'
import type { ContextInput, AgentInputs } from './inputs'
import { BotError } from '../bots/bot-service'

export type CreateConversation = {
  threadId: string
  botId?: string
  title?: string
  workspaceId?: string | null
  permissionMode?: PermissionMode
  initialize?: Parameters<AgentEngine['create']>[3]
  agent: AgentChange
}

export const DEFAULT_CONVERSATION_TITLE = '新会话'

const TITLE_LIMIT = 50
type ConversationUpdate = {
  title?: string
  archived?: boolean
  permissionMode?: PermissionMode
  workspaceId?: string | null
  deletedAt?: number
}

function titleFromInput(content: ContextInput['content']) {
  const text =
    typeof content === 'string'
      ? content
      : content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(' ')
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > TITLE_LIMIT ? `${normalized.slice(0, TITLE_LIMIT - 3)}...` : normalized
}

export const creationRecord = defineDoc<{
  id: string
  botId?: string | null
  deletedAt?: number | null
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
    private readonly validateUpdate?: (
      threadId: string,
      update: { workspaceId?: string | null; permissionMode?: PermissionMode },
      context: Context,
    ) => Promise<void>,
    private readonly exclusiveWorkspace?: <T>(
      threadId: string,
      action: () => Promise<T>,
    ) => Promise<T>,
  ) {}

  async create(input: CreateConversation, context: Context) {
    const existing = await this.sessions.findById(input.threadId)
    const links = await this.engine.links(context)
    if (existing && Object.hasOwn(links, existing.id)) {
      await this.engine.conversation(existing.id, context)
      return existing
    }
    const now = Date.now()
    const initialRecord = {
      id: input.threadId,
      botId: input.botId ?? null,
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
    return (await this.sessions.findAll()).filter(
      (record) => !record.deletedAt && Object.hasOwn(links, record.id),
    )
  }

  async get(threadId: string, context: Context) {
    const record = await this.sessions.findById(threadId)
    if (!record) throw new Error('Conversation not found')
    const links = await this.engine.links(context)
    if (!Object.hasOwn(links, record.id)) throw new Error('Conversation not found')
    await this.engine.conversation(threadId, context)
    return record
  }

  async update(threadId: string, update: ConversationUpdate, context: Context) {
    const save = () => this.updateMetadata(threadId, update, context)
    return update.workspaceId !== undefined && this.exclusiveWorkspace
      ? this.exclusiveWorkspace(threadId, save)
      : save()
  }

  private async updateMetadata(threadId: string, update: ConversationUpdate, context: Context) {
    const record = await this.get(threadId, context)
    await this.validateUpdate?.(threadId, update, context)
    const next = { ...record, ...update, updatedAt: Math.max(Date.now(), record.updatedAt + 1) }
    await this.sessions.save(next)
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
    await this.cancel(threadId, context)
    return this.update(threadId, { archived: true, deletedAt: Date.now() }, context)
  }

  async submit(threadId: string, input: ContextInput, context: Context) {
    if (!input.requestId.trim()) throw new Error('A stable request ID is required')
    const record = await this.get(threadId, context)
    if (record.deletedAt) throw new BotError(404, 'Conversation was deleted')
    const conversation = await this.engine.conversation(threadId, context)
    if (!this.inputs && (input.contextAttachmentIds?.length || input.skillIds?.length))
      throw new Error('Input context service is not configured')
    const submission = this.inputs
      ? await this.inputs.submit(conversation, input, context)
      : await conversation.submit(input, context)
    const title =
      record.title === DEFAULT_CONVERSATION_TITLE && !input.scheduledTaskId
        ? titleFromInput(input.content)
        : undefined
    if (title && title !== DEFAULT_CONVERSATION_TITLE)
      await this.update(threadId, { title }, context)
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
