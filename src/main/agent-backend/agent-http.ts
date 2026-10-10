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
import type { AgentFrame } from '@/shared/agent/chat-protocol'
import { AgentHost } from '../agent/agent-host'
import { approvalSignalDoc } from '../agent/approvals'
import { contentText, emptySnapshot } from '../agent/projection'
import {
  HttpError,
  readJsonBody,
  startAuthenticatedServer,
  type AgentHttpServerOptions,
} from './http-server'

const createSchema = Type.Object(
  {
    threadId: Type.String({ minLength: 1 }),
    title: Type.Optional(Type.String()),
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
  },
  { additionalProperties: false },
)
const decisionSchema = Type.Object(
  { state: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]) },
  { additionalProperties: false },
)
const metadataSchema = Type.Partial(
  Type.Object({ title: Type.String(), archived: Type.Boolean() }, { additionalProperties: false }),
)
const thinkingLevelSchema = Type.Union((['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((level) => Type.Literal(level)))
const modelSchema = Type.Object(
  { provider: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }), thinkingLevel: Type.Optional(thinkingLevelSchema) },
  { additionalProperties: false },
)
const thinkingSchema = Type.Object({ level: thinkingLevelSchema }, { additionalProperties: false })
const continueSchema = Type.Object({ threadId: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const queueMutationSchema = Type.Object(
  {
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
    'agent',
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
    if ('historical' in metadata && metadata.historical) {
      return context.json({
        snapshot: emptySnapshot(),
        approvals: [],
        queue: [],
        metadata,
        historical: true,
        history: await host.readHistory(threadId, ctx),
      })
    }
    const conversation = await host.engine.conversation(threadId, ctx)
    return context.json({
      snapshot: await host.conversations.snapshot(threadId, ctx),
      approvals: await host.pendingApprovals(threadId, ctx),
      queue: (await host.engine.harness.snapshot(InboxDoc, conversation.id, ctx))?.items ?? [],
      metadata,
      contextWindow: host.models.contextWindow((await host.engine.harness.snapshot(AgentDoc, conversation.id, ctx))?.model),
      history: await host.readHistory(threadId, ctx),
    })
  }
  if (parts.length === 2 && method === 'PATCH') {
    const input = await parse(context, metadataSchema)
    return context.json(await host.conversations.update(threadId, input, ctx))
  }
  if (parts.length === 2 && method === 'DELETE') {
    await host.conversations.tombstone(threadId, ctx)
    return context.body(null, 204)
  }
  if (parts.length === 3 && action === 'continue' && method === 'POST') {
    await host.conversations.get(threadId, ctx)
    const input = await parse(context, continueSchema)
    return context.json(await host.continueHistory(threadId, input.threadId, ctx), 201)
  }
  const conversation = await host.engine.conversation(threadId, ctx)
  if (parts.length === 3 && action === 'submissions' && method === 'POST') {
    return context.json(
      await host.conversations.submit(threadId, await parse(context, inputSchema), ctx),
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
  if (parts.length === 3 && action === 'archive' && method === 'POST') {
    await host.conversations.archive(threadId, true, ctx)
    return context.body(null, 204)
  }
  if (parts.length === 3 && action === 'unarchive' && method === 'POST') {
    await host.conversations.archive(threadId, false, ctx)
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
  if (parts.length === 4 && action === 'queue' && parts[3] === 'clear' && method === 'POST') {
    const queue = (await host.engine.harness.snapshot(InboxDoc, conversation.id, ctx))?.items ?? []
    await Promise.all(queue.filter((item) => item.mode !== 'write').map((item) => host.engine.harness.abortSubmission(item.id, ctx, conversation.id)))
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
          const frame: AgentFrame = {
            type: batch.some((event) => event.type === 'snapshot') ? 'reset' : 'events',
            threadId,
            epoch,
            sequence: ++sequence,
            contextWindow: host.models.contextWindow((await host.engine.harness.snapshot(AgentDoc, conversation.id, streamContext))?.model),
            events: batch,
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
  const text = (item: InboxItem) => (item.mode === 'write' ? '' : contentText(item.content))
  const current = (await host.engine.harness.snapshot(InboxDoc, conversationId, context))?.items ?? []
  const candidates = current.filter((item) => item.mode === mode)
  if (JSON.stringify(candidates.map(text)) !== JSON.stringify(input.expected)) throw new Error('Queue changed')
  if (input.index >= candidates.length) throw new Error('Queue changed')
  if (input.action === 'steer' && mode !== 'followUp') throw new Error('Invalid queue operation')
  if (input.action === 'edit' && (typeof input.value !== 'string' || !input.value.trim())) throw new Error('Invalid queue operation')
  if (input.action === 'move' && (typeof input.value !== 'number' || input.value < 0 || input.value >= candidates.length)) throw new Error('Invalid queue operation')
  const target = candidates[input.index]!
  if (input.action === 'remove') await host.engine.harness.abortSubmission(target.id, context, conversationId)
  else await host.engine.harness.commit(async (tx) => {
    const doc = await tx.doc(InboxDoc, conversationId)
    if (JSON.stringify(doc.items.filter((item) => item.mode === mode).map(text)) !== JSON.stringify(input.expected))
      throw new HttpError(409, 'queue_changed', 'Queue changed')
    const index = doc.items.findIndex((item) => item.id === target.id)
    if (index < 0 || doc.items[index]?.mode !== mode) throw new Error('Queue changed')
    if (input.action === 'edit') {
      const item = doc.items[index]
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
