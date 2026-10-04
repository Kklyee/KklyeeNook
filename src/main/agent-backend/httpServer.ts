import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type { Server } from 'node:http'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type {
  PiClientEvent,
  PiHostUiResponse,
  PiSendMessageInput,
  PiThinkingLevel,
} from '@assistant-ui/react-pi/node'

import type { ContextAwarePiClient } from '@/shared/pi/piClient'
import type { PiQueueMutation } from '@/shared/pi/piClient'

const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 4 * 1024 * 1024

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface AgentHttpServerOptions {
  secret?: string
  allowedOrigins?: readonly string[]
}

export interface RunningAgentHttpServer {
  baseUrl: string
  port: number
  close(): Promise<void>
}

export async function startAgentHttpServer(
  client: ContextAwarePiClient,
  options: AgentHttpServerOptions = {},
): Promise<RunningAgentHttpServer> {
  const secret = options.secret ?? randomBytes(32).toString('hex')
  const prefix = `/${secret}/api/pi`
  const allowedOrigins = new Set(options.allowedOrigins ?? [])
  const app = new Hono()

  app.use('*', async (context, next) => {
    const origin = context.req.header('origin')
    if (origin && !allowedOrigins.has(origin)) {
      return sendError(context, 403, 'forbidden', 'Origin is not allowed.')
    }
    if (origin) {
      context.header('Access-Control-Allow-Origin', origin)
      context.header('Vary', 'Origin')
    }
    if (context.req.header('access-control-request-private-network') === 'true') {
      context.header('Access-Control-Allow-Private-Network', 'true')
    }
    if (context.req.method === 'OPTIONS') {
      context.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
      context.header('Access-Control-Allow-Headers', 'content-type')
      context.header('Access-Control-Max-Age', '600')
      return context.body(null, 204)
    }
    return next()
  })

  app.get('/health', (context) => context.json({ ok: true, service: 'kklyeenook-agent-backend' }))
  app.all('*', async (context) => handleRequest(context, client, prefix))
  app.onError((error, context) => sendUnexpectedError(context, error))

  const server = serve({ fetch: app.fetch, port: 0, hostname: HOST }) as Server
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Agent backend did not bind a TCP port')

  const { port } = address
  return {
    baseUrl: `http://${HOST}:${port}/${secret}/api/pi`,
    port,
    close: () => closeServer(server),
  }
}

async function handleRequest(
  context: Context,
  client: ContextAwarePiClient,
  prefix: string,
): Promise<Response> {
  const url = new URL(context.req.url)
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
    return sendError(context, 404, 'not_found', 'Route not found.')
  }

  const route = url.pathname.slice(prefix.length) || '/'
  const segments = route.split('/').filter(Boolean).map(decodeSegment)
  if (segments.some((segment) => segment === null)) {
    return sendError(context, 400, 'bad_request', 'Invalid route.')
  }
  const parts = segments as string[]

  if (parts.length === 1 && parts[0] === 'threads' && context.req.method === 'GET') {
    const workspacePath = context.req.query('workspacePath') ?? undefined
    const includeArchived = context.req.query('includeArchived') === 'true'
    return context.json(await client.listThreads({ workspacePath, includeArchived }))
  }

  if (parts.length === 1 && parts[0] === 'threads' && context.req.method === 'POST') {
    return context.json(
      await client.createThread(parseCreateThreadInput(await readJsonBody(context))),
    )
  }

  if (parts.length === 1 && parts[0] === 'models' && context.req.method === 'GET') {
    const workspacePath = context.req.query('workspacePath') ?? undefined
    return context.json(await client.getAvailableModels({ workspacePath }))
  }

  if (parts.length < 2 || parts[0] !== 'threads') {
    return sendError(context, 404, 'not_found', 'Route not found.')
  }

  const threadId = parts[1]
  const action = parts.slice(2)

  if (action.length === 0 && context.req.method === 'GET') {
    return context.json(await client.getThread(threadId))
  }
  if (action.length === 0 && context.req.method === 'PATCH') {
    const body = await readJsonBody(context)
    if (!isRecord(body) || typeof body.title !== 'string') {
      throw new HttpError(400, 'bad_request', 'Expected a thread title.')
    }
    await client.renameThread(threadId, body.title)
    return sendNoContent(context)
  }
  if (action.length === 0 && context.req.method === 'DELETE') {
    await client.deleteThread(threadId)
    return sendNoContent(context)
  }
  if (action.length === 1 && action[0] === 'messages' && context.req.method === 'POST') {
    const body = await readJsonBody(context)
    if (!isRecord(body) || !isRecord(body.input) || typeof body.input.content !== 'string') {
      throw new HttpError(400, 'bad_request', 'Expected a message input.')
    }
    const ids = body.contextAttachmentIds
    if (ids !== undefined && (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string'))) {
      throw new HttpError(400, 'bad_request', 'Invalid context attachment IDs.')
    }
    await client.sendMessage(
      threadId,
      body.input as unknown as PiSendMessageInput,
      ids as string[] | undefined,
    )
    return sendNoContent(context)
  }
  if (action.length === 1 && action[0] === 'cancel' && context.req.method === 'POST') {
    await client.cancelRun(threadId)
    return sendNoContent(context)
  }
  if (
    action.length === 2 &&
    action[0] === 'queue' &&
    action[1] === 'clear' &&
    context.req.method === 'POST'
  ) {
    return context.json(await client.clearQueue(threadId))
  }
  if (
    action.length === 2 &&
    action[0] === 'queue' &&
    action[1] === 'item' &&
    context.req.method === 'POST'
  ) {
    const body = await readJsonBody(context)
    if (
      !isRecord(body) ||
      !['steer', 'followUp'].includes(String(body.mode)) ||
      !Array.isArray(body.expected) ||
      !body.expected.every((text) => typeof text === 'string') ||
      !Number.isInteger(body.index) ||
      !(
        body.action === 'remove' ||
        (body.action === 'steer' && body.mode === 'followUp') ||
        (body.action === 'edit' && typeof body.value === 'string' && body.value.trim()) ||
        (body.action === 'move' && Number.isInteger(body.value))
      )
    ) {
      throw new HttpError(400, 'bad_request', 'Invalid queue operation.')
    }
    try {
      return context.json(await client.updateQueuedMessage(threadId, body as PiQueueMutation))
    } catch (error) {
      throw new HttpError(
        409,
        'queue_changed',
        error instanceof Error ? error.message : 'Queue changed; refresh and try again',
      )
    }
  }
  if (action.length === 1 && action[0] === 'model' && context.req.method === 'POST') {
    const body = await readJsonBody(context)
    if (!isRecord(body) || typeof body.provider !== 'string' || typeof body.modelId !== 'string') {
      throw new HttpError(400, 'bad_request', 'Expected a provider and model ID.')
    }
    await client.setModel(threadId, { provider: body.provider, modelId: body.modelId })
    return sendNoContent(context)
  }
  if (action.length === 1 && action[0] === 'thinking' && context.req.method === 'POST') {
    const body = await readJsonBody(context)
    if (!isRecord(body) || typeof body.level !== 'string') {
      throw new HttpError(400, 'bad_request', 'Expected a thinking level.')
    }
    await client.setThinkingLevel(threadId, body.level as PiThinkingLevel)
    return sendNoContent(context)
  }
  if (action.length === 1 && action[0] === 'archive' && context.req.method === 'POST') {
    await client.archiveThread(threadId)
    return sendNoContent(context)
  }
  if (action.length === 1 && action[0] === 'unarchive' && context.req.method === 'POST') {
    await client.unarchiveThread(threadId)
    return sendNoContent(context)
  }
  if (action.length === 1 && action[0] === 'host-ui' && context.req.method === 'POST') {
    const body = await readJsonBody(context)
    if (
      !isRecord(body) ||
      !isRecord(body.response) ||
      typeof body.response.requestId !== 'string'
    ) {
      throw new HttpError(400, 'bad_request', 'Expected a host UI response.')
    }
    await client.respondToHostUiRequest(threadId, body.response as unknown as PiHostUiResponse)
    return sendNoContent(context)
  }
  if (action.length === 1 && action[0] === 'events' && context.req.method === 'GET') {
    return sendEvents(context, client, threadId, context.req.query('snapshot') !== 'false')
  }

  return sendError(context, 404, 'not_found', 'Route not found.')
}

function sendEvents(
  context: Context,
  client: ContextAwarePiClient,
  threadId: string,
  includeSnapshot: boolean,
): Response {
  context.header('X-Accel-Buffering', 'no')
  const response = streamSSE(context, async (stream) => {
    let unsubscribe: (() => void) | undefined
    let resolveClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    let ended = false
    const heartbeat = setInterval(() => {
      void stream.write(': ping\n\n').catch(close)
    }, 15_000)
    heartbeat.unref()
    const close = () => {
      if (ended) return
      ended = true
      clearInterval(heartbeat)
      unsubscribe?.()
      resolveClosed()
    }
    stream.onAbort(close)
    unsubscribe = client.subscribe(
      threadId,
      (event: PiClientEvent) => {
        void stream.writeSSE({ data: JSON.stringify(event) }).catch(close)
      },
      { includeSnapshot },
    )
    if (stream.aborted) close()
    await closed
  })
  response.headers.set('Content-Type', 'text/event-stream; charset=utf-8')
  return response
}

async function readJsonBody(context: Context): Promise<unknown> {
  const body = await context.req.arrayBuffer()
  if (body.byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', 'Request body is too large.')
  }
  if (!body.byteLength) return {}
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    throw new HttpError(400, 'bad_request', 'Request body must be valid JSON.')
  }
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCreateThreadInput(
  value: unknown,
): Parameters<ContextAwarePiClient['createThread']>[0] {
  if (!isRecord(value)) throw new HttpError(400, 'bad_request', 'Expected thread options.')
  if (value.workspacePath !== undefined && typeof value.workspacePath !== 'string') {
    throw new HttpError(400, 'bad_request', 'Invalid workspace path.')
  }
  if (value.title !== undefined && typeof value.title !== 'string') {
    throw new HttpError(400, 'bad_request', 'Invalid thread title.')
  }
  if (
    value.initialMessage !== undefined &&
    (!isRecord(value.initialMessage) || typeof value.initialMessage.content !== 'string')
  ) {
    throw new HttpError(400, 'bad_request', 'Invalid initial message.')
  }
  return {
    ...(typeof value.workspacePath === 'string' ? { workspacePath: value.workspacePath } : {}),
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(isRecord(value.initialMessage)
      ? { initialMessage: value.initialMessage as unknown as PiSendMessageInput }
      : {}),
  }
}

function sendNoContent(context: Context): Response {
  return context.body(null, 204)
}

function sendError(context: Context, status: number, code: string, message: string): Response {
  return context.json({ error: { code, message } }, status as ContentfulStatusCode)
}

function sendUnexpectedError(context: Context, error: unknown): Response {
  if (error instanceof HttpError) {
    return sendError(context, error.status, error.code, error.message)
  }
  const rawMessage = error instanceof Error ? error.message : ''
  if (/not found/i.test(rawMessage)) {
    return sendError(context, 404, 'not_found', 'Thread not found.')
  }
  if (/(running|active run|invalid state|cannot .* while)/i.test(rawMessage)) {
    return sendError(context, 409, 'conflict', 'Operation conflicts with the current agent state.')
  }
  return sendError(context, 500, 'internal_error', 'Agent backend request failed.')
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  server.closeAllConnections()
  return closed
}
