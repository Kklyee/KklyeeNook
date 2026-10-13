import { snapshotContextUsage } from '@kklyeenook/shared/agent/projection'
import { threadHistory } from '../runtime/thread-history'
import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import type { Context as ChordContext } from '@earendil-works/chord'
import { streamSSE } from 'hono/streaming'
import { Type, type Static, type TSchema } from 'typebox'
import { Value } from 'typebox/value'
import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context'
import {
  InboxDoc,
  AgentDoc,
  type AgentEvent,
  type ConversationId,
  type InboxItem,
  type SubmissionId,
} from '@earendil-works/pi-durable'
import type { AgentFrame } from '@kklyeenook/shared/agent/chat-protocol'
import { AgentHost } from '../runtime/agent-host'
import { botSchema } from '../bots/bot-schema'
import { approvalSignalDoc } from '../runtime/approvals'
import {
  HttpError,
  readJsonBody,
  startAuthenticatedServer,
  type AgentHttpServerOptions,
} from './http-server'

const thinkingLevelSchema = Type.Union((['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((level) => Type.Literal(level)))
const createSchema = Type.Object(
  {
    threadId: Type.String({ minLength: 1 }),
    botId: Type.Optional(Type.String({ minLength: 1 })),
    title: Type.Optional(Type.String()),
    model: Type.Optional(Type.Object(
      { provider: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    )),
    thinkingLevel: Type.Optional(thinkingLevelSchema),
    workspaceId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
    permissionMode: Type.Optional(
      Type.Union([
        Type.Literal('read-only'),
        Type.Literal('workspace-write'),
        Type.Literal('full-access'),
      ]),
    ),
  },
  { additionalProperties: false },
)
const inputSchema = Type.Object(
  {
    type: Type.Literal('input'),
    requestId: Type.String({ minLength: 1 }),
    content: Type.Union([
      Type.String(),
      Type.Array(
        Type.Union([
          Type.Object(
            { type: Type.Literal('text'), text: Type.String() },
            { additionalProperties: false },
          ),
          Type.Object(
            { type: Type.Literal('image'), data: Type.String(), mimeType: Type.String() },
            { additionalProperties: false },
          ),
        ]),
      ),
    ]),
    whenBusy: Type.Optional(
      Type.Union([Type.Literal('steer'), Type.Literal('followUp'), Type.Literal('reject')]),
    ),
    contextAttachmentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    skillIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    botMentions: Type.Optional(Type.Array(Type.Object({ botId: Type.String({ minLength: 1, maxLength: 200 }), displayName: Type.String({ minLength: 1, maxLength: 100 }), start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }), { maxItems: 3 })),
  },
  { additionalProperties: false },
)
const decisionSchema = Type.Object(
  { state: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]) },
  { additionalProperties: false },
)
const metadataSchema = Type.Partial(
  Type.Object({ title: Type.String({ minLength: 1 }), archived: Type.Boolean(), workspaceId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]) }, { additionalProperties: false }),
  { additionalProperties: false },
)
const modelSchema = Type.Object(
  { provider: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }), thinkingLevel: Type.Optional(thinkingLevelSchema) },
  { additionalProperties: false },
)
const thinkingSchema = Type.Object({ level: thinkingLevelSchema }, { additionalProperties: false })
const queueMutationSchema = Type.Object(
  {
    itemId: Type.Optional(Type.String({ minLength: 1 })),
    mode: Type.Union([Type.Literal('steer'), Type.Literal('followUp')]),
    expected: Type.Array(Type.String()),
    index: Type.Integer({ minimum: 0 }),
    action: Type.Union([
      Type.Literal('remove'),
      Type.Literal('steer'),
      Type.Literal('edit'),
      Type.Literal('move'),
    ]),
    value: Type.Optional(Type.Union([Type.String(), Type.Integer({ minimum: 0 })])),
  },
  { additionalProperties: false },
)

export function startAgentHttpServer(host: AgentHost, options: AgentHttpServerOptions = {}) {
  return startAuthenticatedServer(
    (context, prefix) => handle(context, prefix, host),
    options,
  )
}

async function parse<T extends TSchema>(context: Context, schema: T): Promise<Static<T>> {
  const value = await readJsonBody(context)
  if (!Value.Check(schema, value)) throw new HttpError(400, 'bad_request', 'Invalid request input.')
  return value as Static<T>
}

async function handle(context: Context, prefix: string, host: AgentHost): Promise<Response> {
  const path = new URL(context.req.url).pathname
  if (!path.startsWith(prefix + '/')) throw new HttpError(404, 'not_found', 'Route not found.')
  let parts: string[]
  try {
    parts = path
      .slice(prefix.length + 1)
      .split('/')
      .map(decodeURIComponent)
  } catch {
    throw new HttpError(400, 'bad_request', 'Invalid route.')
  }
  const ctx = withAbortSignal(context.req.raw.signal, BACKGROUND_CONTEXT)
  const method = context.req.method
  if (parts[0] === 'grove' && host.grove) {
    if (parts[1] === 'mention-targets' && method === 'GET') return context.json(await host.grove.mentionTargets(context.req.query('threadId') ?? '', ctx))
    if (parts.length === 1 && method === 'GET') return context.json(await host.grove.list(ctx))
    if (parts.length === 3 && parts[1] === 'policies' && method === 'PUT') {
      const policy = await parse(context, Type.Object({ maxConcurrentTasks: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), messages: Type.Boolean(), tasks: Type.Boolean(), allowedBotIds: Type.Union([Type.Null(), Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 100 })]) }, { additionalProperties: false }))
      return context.json(await host.grove.setPolicy(parts[2], policy, ctx))
    }
    if (parts.length === 2 && method === 'POST' && (parts[1] === 'messages' || parts[1] === 'tasks')) {
      const common = { threadId: Type.String({ minLength: 1, maxLength: 200 }), toBotId: Type.String({ minLength: 1, maxLength: 200 }), operationId: Type.String({ minLength: 1, maxLength: 200 }) }
      if (parts[1] === 'messages') {
        const input = await parse(context, Type.Object({ ...common, content: Type.String({ minLength: 1, maxLength: 64000 }) }, { additionalProperties: false }))
        return context.json(await host.grove.sendMessage({ threadId: input.threadId }, input, ctx), 201)
      }
      const input = await parse(context, Type.Object({ ...common, instruction: Type.String({ minLength: 1, maxLength: 64000 }) }, { additionalProperties: false }))
      const conversation = await host.engine.conversation(input.threadId, ctx)
      const parentTaskId = await host.inputs.activeGroveTask(conversation.id, ctx)
      return context.json(await host.grove.requestTask({ threadId: input.threadId, parentTaskId }, input, ctx), 202)
    }
  }
  if (parts[0] === 'bots' && host.bots) {
    if (parts.length === 1 && method === 'GET') return context.json(await host.botSummaries(ctx))
    if (parts.length === 1 && method === 'POST') return context.json(await host.bots.create(await parse(context, botSchema)), 201)
    const id = parts[1]
    if (parts.length === 2 && method === 'GET') return context.json(await host.bots.get(id))
    if (parts.length === 2 && method === 'PATCH') return context.json(await host.bots.update(id, await parse(context, Type.Partial(botSchema, { additionalProperties: false }))))
    if (parts.length === 2 && method === 'DELETE') {
      await parse(context, Type.Object({ strategy: Type.Literal('archive-conversations') }, { additionalProperties: false }))
      await host.deleteBot(id, ctx)
      return context.body(null, 204)
    }
    if (parts.length === 3 && method === 'POST') {
      if (parts[2] === 'main-thread') return context.json(await host.mainThread(id, ctx))
      if (parts[2] === 'duplicate') return context.json(await host.bots.duplicate(id), 201)
      if (parts[2] === 'reset') return context.json(await host.bots.reset(id))
    }
  }
  if (parts[0] === 'bot-options' && method === 'GET') return context.json({ workspaces: await host.workspaces(), tools: host.availableTools() })
  if (parts[0] !== 'threads') throw new HttpError(404, 'not_found', 'Route not found.')
  if (parts.length === 1) {
    if (method === 'GET') return context.json(await host.conversations.list(ctx))
    if (method === 'POST')
      return context.json(await host.create(await parse(context, createSchema), ctx), 201)
  }
  const threadId = parts[1]
  if (!threadId) throw new HttpError(404, 'not_found', 'Route not found.')
  const action = parts[2]
  if (parts.length === 2 && method === 'GET') {
    const metadata = await host.conversations.get(threadId, ctx)
    const conversation = await host.engine.conversation(threadId, ctx)
    const snapshot = await host.conversations.snapshot(threadId, ctx)
    const history = context.req.query('runs') === '2' ? await threadHistory(host, threadId, snapshot, ctx) : undefined
    return context.json({
      contextUsage: snapshotContextUsage(snapshot, host.models.contextWindow(snapshot.agent.model)),
      history: history && { sinceEntry: history.sinceEntry, hasMore: history.hasMore },
      snapshot: history ? { ...snapshot, entries: history.entries } : snapshot,
      approvals: await host.pendingApprovals(threadId, ctx),
      queue: (await host.engine.harness.snapshot(InboxDoc, conversation.id, ctx))?.items ?? [],
      metadata,
      contextWindow: host.models.contextWindow((await host.engine.harness.snapshot(AgentDoc, conversation.id, ctx))?.model),
    })
  }
  if (parts.length === 2 && method === 'PATCH') {
    const input = await parse(context, metadataSchema)
    if (input.archived) await host.assertExtraThread(threadId, ctx)
    return context.json(await host.conversations.update(threadId, input, ctx))
  }
  if (parts.length === 2 && method === 'DELETE') {
    await host.assertExtraThread(threadId, ctx)
    await host.conversations.tombstone(threadId, ctx)
    return context.body(null, 204)
  }
  if (parts.length === 3 && (action === 'archive' || action === 'unarchive') && method === 'POST') {
    if (action === 'archive') await host.assertExtraThread(threadId, ctx)
    await host.conversations.archive(threadId, action === 'archive', ctx)
    return context.body(null, 204)
  }
  await host.conversations.get(threadId, ctx)
  const conversation = await host.engine.conversation(threadId, ctx)
  if (parts.length === 3 && action === 'history' && method === 'GET') {
    const before = Number(context.req.query('before'))
    if (!Number.isSafeInteger(before) || before <= 0) throw new HttpError(400, 'bad_request', 'Invalid history cursor.')
    return context.json(await threadHistory(host, threadId, await host.conversations.snapshot(threadId, ctx), ctx, before))
  }
  if (parts.length === 3 && action === 'submissions' && method === 'POST') {
    const input = await parse(context, inputSchema)
    return context.json(
      await host.conversations.submit(threadId, { ...input, whenBusy: input.whenBusy ?? 'reject' }, ctx),
      202,
    )
  }
  if (parts.length === 4 && action === 'submissions') {
    const number = /^\d+$/.test(parts[3]) ? Number(parts[3]) : NaN
    if (!Number.isSafeInteger(number) || number <= 0)
      throw new HttpError(400, 'bad_request', 'Invalid submission ID.')
    const id = number as SubmissionId
    if (method === 'GET') return context.json(await host.conversations.status(threadId, id, ctx))
    if (method === 'DELETE')
      return context.json({ status: await host.conversations.withdraw(threadId, id, ctx) })
  }
  if (parts.length === 3 && action === 'cancel' && method === 'POST') {
    await host.conversations.cancel(threadId, ctx)
    return context.body(null, 204)
  }
  if (parts.length === 3 && action === 'model' && method === 'POST') {
    const { provider, modelId, thinkingLevel } = await parse(context, modelSchema)
    await host.configure(threadId, { model: { provider, modelId }, thinkingLevel }, ctx)
    return context.body(null, 204)
  }
  if (parts.length === 3 && action === 'thinking' && method === 'POST') {
    await host.configure(threadId, { thinkingLevel: (await parse(context, thinkingSchema)).level }, ctx)
    return context.body(null, 204)
  }
  if (parts.length === 3 && action === 'queue' && method === 'GET') {
    return context.json((await host.engine.harness.snapshot(InboxDoc, conversation.id, ctx))?.items ?? [])
  }
  if (parts.length === 4 && action === 'queue' && parts[3] === 'item' && method === 'POST') {
    return context.json(await mutateQueue(host, conversation.id, await parse(context, queueMutationSchema), ctx))
  }
  if (parts.length === 3 && action === 'approvals' && method === 'GET') {
    return context.json(await host.pendingApprovals(threadId, ctx))
  }
  if (parts.length === 4 && action === 'approvals' && method === 'POST') {
    const { state } = await parse(context, decisionSchema)
    try {
      return context.json({
        state: await host.decideApproval(threadId, parts[3], state, ctx),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'Approval not found') throw new HttpError(404, 'not_found', message)
      if (message === 'Approval already decided' || message === 'Approval no longer active')
        throw new HttpError(409, 'conflict', message)
      throw error
    }
  }
  if (parts.length === 3 && action === 'events' && method === 'GET') {
    const lifetime = new AbortController()
    const streamContext = withAbortSignal(
      AbortSignal.any([context.req.raw.signal, lifetime.signal]),
      BACKGROUND_CONTEXT,
    )
    const events = await host.engine.watch(threadId, streamContext)
    const approvals = await host.engine.harness
      .watchDoc(approvalSignalDoc, streamContext)
      .catch(async (error) => {
        await events.stop()
        throw error
      })
    if (!approvals) {
      await events.stop()
      throw new Error('Approval document was not initialized')
    }
    context.header('X-Accel-Buffering', 'no')
    return streamSSE(context, async (stream) => {
      let resolveClosed!: () => void
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve
      })
      const finish = () => {
        lifetime.abort()
        stream.abort()
        resolveClosed()
      }
      stream.onAbort(() => {
        lifetime.abort()
        resolveClosed()
      })
      void events.closed.then(finish)
      void approvals.closed.then(finish)
      const heartbeat = setInterval(() => {
        void stream.write(': ping\n\n').catch(finish)
      }, 15_000)
      heartbeat.unref()
      const epoch = randomUUID()
      let sequence = -1
      let tail: Promise<void> = Promise.resolve()
      const send = (batch: readonly AgentEvent[]) => {
        tail = tail.then(async () => {
          const snapshots = await Promise.all(batch.map(async (event) => {
            if (event.type !== 'snapshot' || context.req.query('runs') !== '2') return event
            const history = await threadHistory(host, threadId, event, streamContext)
            return { ...event, entries: history.entries }
          }))
          const frame: AgentFrame = {
            type: batch.some((event) => event.type === 'snapshot') ? 'reset' : 'events',
            threadId,
            epoch,
            sequence: ++sequence,
            contextWindow: host.models.contextWindow((await host.engine.harness.snapshot(AgentDoc, conversation.id, streamContext))?.model),
            events: snapshots,
            contextUsage: batch.some((event) => event.type !== 'message_update') ? snapshotContextUsage(events.snapshot, host.models.contextWindow(events.snapshot.agent.model)) : undefined,
            approvals: await host.pendingApprovals(threadId, streamContext),
            queue:
              (await host.engine.harness.snapshot(InboxDoc, conversation.id, streamContext))
                ?.items ?? [],
          }
          await awaitWithContext(
            stream.writeSSE({ id: `${epoch}:${sequence}`, data: JSON.stringify(frame) }),
            streamContext,
          )
        })
        return tail
      }
      try {
        await send([events.snapshot])
        events.start(send)
        approvals.start(async () => {
          await send([])
        })
        await closed
      } catch (error) {
        if (!lifetime.signal.aborted) throw error
      } finally {
        clearInterval(heartbeat)
        await Promise.all([events.stop(), approvals.stop()])
      }
    })
  }
  throw new HttpError(404, 'not_found', 'Route not found.')
}

async function mutateQueue(
  host: AgentHost,
  conversationId: ConversationId,
  input: Static<typeof queueMutationSchema>,
  context: ChordContext,
) {
  const mode = input.mode
  const text = (item: InboxItem) => item.mode === 'write' ? '' : typeof item.content === 'string' ? item.content : item.content.map((part) => part.type === 'text' ? part.text : '[image]').join('\n')
  const current = (await host.engine.harness.snapshot(InboxDoc, conversationId, context))?.items ?? []
  const candidates = current.filter((item) => item.mode === mode)
  const targeted = (input.action === 'steer' || input.action === 'remove') && input.itemId !== undefined
  if (!targeted && JSON.stringify(candidates.map(text)) !== JSON.stringify(input.expected)) throw new HttpError(409, 'queue_changed', 'Queue changed')
  if (!targeted && input.index >= candidates.length) throw new HttpError(409, 'queue_changed', 'Queue changed')
  if (input.action === 'steer' && mode !== 'followUp') throw new HttpError(400, 'bad_request', 'Invalid queue operation')
  if (input.action === 'edit' && (typeof input.value !== 'string' || !input.value.trim())) throw new HttpError(400, 'bad_request', 'Invalid queue operation')
  if (input.action === 'move' && (typeof input.value !== 'number' || input.value < 0 || input.value >= candidates.length)) throw new HttpError(400, 'bad_request', 'Invalid queue operation')
  const target = targeted ? current.find((item) => String(item.id) === input.itemId) : candidates[input.index]
  if (!target && targeted && input.action === 'remove') return current
  if (!target) throw new HttpError(409, 'queue_changed', 'Queue changed')
  if (target.mode === 'write') throw new HttpError(400, 'bad_request', 'Invalid queue operation')
  if (targeted && input.action === 'steer' && target.mode === 'steer') return current
  await host.engine.harness.commit(async (tx) => {
    const doc = await tx.doc(InboxDoc, conversationId)
    if (!targeted && JSON.stringify(doc.items.filter((item) => item.mode === mode).map(text)) !== JSON.stringify(input.expected))
      throw new HttpError(409, 'queue_changed', 'Queue changed')
    const index = doc.items.findIndex((item) => item.id === target.id)
    if (input.action === 'remove' && targeted && index < 0) return
    if (targeted && input.action === 'steer' && index >= 0 && doc.items[index]?.mode === 'steer') return
    if (index < 0 || (doc.items[index]?.mode !== mode && !(targeted && input.action === 'remove'))) throw new HttpError(409, 'queue_changed', 'Queue changed')
    if (input.action === 'remove') {
      if (doc.items[index]?.mode === 'write') throw new HttpError(400, 'bad_request', 'Invalid queue operation')
      tx.settleSubmission(target.id, { status: 'unanswered', reason: 'aborted' })
      doc.items.splice(index, 1)
    } else if (input.action === 'edit') {
      const item = doc.items[index]
      if (item.mode === 'write') throw new HttpError(400, 'bad_request', 'Invalid queue operation')
      item.content = input.value as never
    } else if (input.action === 'steer') {
      doc.items[index] = { ...doc.items[index], mode: 'steer' } as never
    } else if (input.action === 'move') {
      const reordered = doc.items.filter((item) => item.mode === mode)
      const [item] = reordered.splice(input.index, 1)
      reordered.splice(input.value as number, 0, item!)
      let position = 0
      doc.items = doc.items.map((item) => item.mode === mode ? reordered[position++]! : item)
    }
  }, context)
  return (await host.engine.harness.snapshot(InboxDoc, conversationId, context))?.items ?? []
}
