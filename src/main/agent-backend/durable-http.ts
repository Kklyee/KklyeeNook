import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { Type, type Static, type TSchema } from 'typebox'
import { Value } from 'typebox/value'
import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context'
import { InboxDoc, type AgentEvent, type SubmissionId } from '@earendil-works/pi-durable'
import type { DurableFrame } from '@/shared/agent/durable-protocol'
import { AgentHost } from '../agent/agent-host'
import { approvalDoc } from '../agent/durable-approvals'
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

export function startDurableHttpServer(host: AgentHost, options: AgentHttpServerOptions = {}) {
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
  const conversation = await host.engine.conversation(threadId, ctx)
  const action = parts[2]
  if (parts.length === 2 && method === 'GET') {
    return context.json({
      snapshot: await host.conversations.snapshot(threadId, ctx),
      approvals: await host.tools.approvals.pending(conversation.id, ctx),
      queue: (await host.engine.harness.snapshot(InboxDoc, conversation.id, ctx))?.items ?? [],
    })
  }
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
  if (parts.length === 3 && action === 'approvals' && method === 'GET') {
    return context.json(await host.tools.approvals.pending(conversation.id, ctx))
  }
  if (parts.length === 4 && action === 'approvals' && method === 'POST') {
    const { state } = await parse(context, decisionSchema)
    try {
      return context.json({
        state: await host.tools.approvals.decide(conversation.id, parts[3], state, ctx),
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
      .watchDoc(approvalDoc, conversation.id, streamContext)
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
          const frame: DurableFrame = {
            type: batch.some((event) => event.type === 'snapshot') ? 'reset' : 'events',
            threadId,
            epoch,
            sequence: ++sequence,
            events: batch,
            approvals: await host.tools.approvals.pending(conversation.id, streamContext),
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
