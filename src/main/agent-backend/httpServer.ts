import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type {
  PiClientEvent,
  PiHostUiResponse,
  PiSendMessageInput,
  PiThinkingLevel,
} from '@assistant-ui/react-pi/node'

import type { ContextAwarePiClient } from '@/shared/pi/piIpc'

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
  const server = createServer((request, response) => {
    void handleRequest(request, response, client, prefix, allowedOrigins).catch((error: unknown) => {
      if (!response.headersSent) sendUnexpectedError(response, error)
      else response.destroy()
    })
  })

  server.listen(0, HOST)
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent backend did not bind a TCP port')

  const { port } = address as AddressInfo
  return {
    baseUrl: `http://${HOST}:${port}/${secret}/api/pi`,
    port,
    close: () => closeServer(server),
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  client: ContextAwarePiClient,
  prefix: string,
  allowedOrigins: ReadonlySet<string>,
): Promise<void> {
  if (!applyCors(request, response, allowedOrigins)) {
    sendError(response, 403, 'forbidden', 'Origin is not allowed.')
    return
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end()
    return
  }

  const url = new URL(request.url ?? '/', `http://${HOST}`)
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'kklyeenook-agent-backend' })
    return
  }

  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
    sendError(response, 404, 'not_found', 'Route not found.')
    return
  }

  const route = url.pathname.slice(prefix.length) || '/'
  const segments = route.split('/').filter(Boolean).map(decodeSegment)
  if (segments.some((segment) => segment === null)) {
    sendError(response, 400, 'bad_request', 'Invalid route.')
    return
  }
  const parts = segments as string[]

  if (parts.length === 1 && parts[0] === 'threads' && request.method === 'GET') {
    const workspacePath = url.searchParams.get('workspacePath') ?? undefined
    const includeArchived = url.searchParams.get('includeArchived') === 'true'
    sendJson(response, 200, await client.listThreads({ workspacePath, includeArchived }))
    return
  }

  if (parts.length === 1 && parts[0] === 'threads' && request.method === 'POST') {
    sendJson(response, 200, await client.createThread(parseCreateThreadInput(await readJsonBody(request))))
    return
  }

  if (parts.length === 1 && parts[0] === 'models' && request.method === 'GET') {
    const workspacePath = url.searchParams.get('workspacePath') ?? undefined
    sendJson(response, 200, await client.getAvailableModels({ workspacePath }))
    return
  }

  if (parts.length < 2 || parts[0] !== 'threads') {
    sendError(response, 404, 'not_found', 'Route not found.')
    return
  }

  const threadId = parts[1]
  const action = parts.slice(2)

  if (action.length === 0 && request.method === 'GET') {
    sendJson(response, 200, await client.getThread(threadId))
    return
  }
  if (action.length === 0 && request.method === 'PATCH') {
    const body = await readJsonBody(request)
    if (!isRecord(body) || typeof body.title !== 'string') {
      throw new HttpError(400, 'bad_request', 'Expected a thread title.')
    }
    await client.renameThread(threadId, body.title)
    sendNoContent(response)
    return
  }
  if (action.length === 0 && request.method === 'DELETE') {
    await client.deleteThread(threadId)
    sendNoContent(response)
    return
  }
  if (action.length === 1 && action[0] === 'messages' && request.method === 'POST') {
    const body = await readJsonBody(request)
    if (!isRecord(body) || !isRecord(body.input) || typeof body.input.content !== 'string') {
      throw new HttpError(400, 'bad_request', 'Expected a message input.')
    }
    const ids = body.contextAttachmentIds
    if (ids !== undefined && (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string'))) {
      throw new HttpError(400, 'bad_request', 'Invalid context attachment IDs.')
    }
    await client.sendMessage(threadId, body.input as unknown as PiSendMessageInput, ids as string[] | undefined)
    sendNoContent(response)
    return
  }
  if (action.length === 1 && action[0] === 'cancel' && request.method === 'POST') {
    await client.cancelRun(threadId)
    sendNoContent(response)
    return
  }
  if (action.length === 2 && action[0] === 'queue' && action[1] === 'clear' && request.method === 'POST') {
    sendJson(response, 200, await client.clearQueue(threadId))
    return
  }
  if (action.length === 1 && action[0] === 'model' && request.method === 'POST') {
    const body = await readJsonBody(request)
    if (
      !isRecord(body) ||
      typeof body.provider !== 'string' ||
      typeof body.modelId !== 'string'
    ) {
      throw new HttpError(400, 'bad_request', 'Expected a provider and model ID.')
    }
    await client.setModel(threadId, { provider: body.provider, modelId: body.modelId })
    sendNoContent(response)
    return
  }
  if (action.length === 1 && action[0] === 'thinking' && request.method === 'POST') {
    const body = await readJsonBody(request)
    if (!isRecord(body) || typeof body.level !== 'string') {
      throw new HttpError(400, 'bad_request', 'Expected a thinking level.')
    }
    await client.setThinkingLevel(threadId, body.level as PiThinkingLevel)
    sendNoContent(response)
    return
  }
  if (action.length === 1 && action[0] === 'archive' && request.method === 'POST') {
    await client.archiveThread(threadId)
    sendNoContent(response)
    return
  }
  if (action.length === 1 && action[0] === 'unarchive' && request.method === 'POST') {
    await client.unarchiveThread(threadId)
    sendNoContent(response)
    return
  }
  if (action.length === 1 && action[0] === 'host-ui' && request.method === 'POST') {
    const body = await readJsonBody(request)
    if (!isRecord(body) || !isRecord(body.response) || typeof body.response.requestId !== 'string') {
      throw new HttpError(400, 'bad_request', 'Expected a host UI response.')
    }
    await client.respondToHostUiRequest(threadId, body.response as unknown as PiHostUiResponse)
    sendNoContent(response)
    return
  }
  if (action.length === 1 && action[0] === 'events' && request.method === 'GET') {
    sendEvents(request, response, client, threadId, url.searchParams.get('snapshot') !== 'false')
    return
  }

  sendError(response, 404, 'not_found', 'Route not found.')
}

function sendEvents(
  request: IncomingMessage,
  response: ServerResponse,
  client: ContextAwarePiClient,
  threadId: string,
  includeSnapshot: boolean,
): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()

  let closed = false
  let unsubscribe: (() => void) | undefined
  const heartbeat = setInterval(() => {
    if (!closed) response.write(': ping\n\n')
  }, 15_000)
  heartbeat.unref()

  const close = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe?.()
  }

  response.once('close', close)
  request.once('aborted', close)
  unsubscribe = client.subscribe(
    threadId,
    (event: PiClientEvent) => {
      if (!closed && !response.destroyed) response.write(`data: ${JSON.stringify(event)}\n\n`)
    },
    { includeSnapshot },
  )
  if (closed) unsubscribe()
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const origin = request.headers.origin
  if (origin && !allowedOrigins.has(origin)) return false
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  if (request.headers['access-control-request-private-network'] === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'content-type')
    response.setHeader('Access-Control-Max-Age', '600')
  }
  return true
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'Request body is too large.')
    chunks.push(buffer)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
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

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function sendNoContent(response: ServerResponse): void {
  response.writeHead(204).end()
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ error: { code, message } }))
}

function sendUnexpectedError(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  const rawMessage = error instanceof Error ? error.message : ''
  if (/not found/i.test(rawMessage)) {
    sendError(response, 404, 'not_found', 'Thread not found.')
    return
  }
  if (/(running|active run|invalid state|cannot .* while)/i.test(rawMessage)) {
    sendError(response, 409, 'conflict', 'Operation conflicts with the current agent state.')
    return
  }
  sendError(response, 500, 'internal_error', 'Agent backend request failed.')
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  server.closeAllConnections()
  return closed
}
