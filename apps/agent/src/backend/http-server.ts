import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import type { Server } from 'node:http'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { BotError } from '../bots/bot-service'

const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 4 * 1024 * 1024

export class HttpError extends Error {
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

export async function startAuthenticatedServer(
  handle: (context: Context, prefix: string) => Promise<Response>,
  options: AgentHttpServerOptions = {},
): Promise<RunningAgentHttpServer> {
  const secret = options.secret ?? randomBytes(32).toString('hex')
  const prefix = `/${secret}/api/agent`
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
  app.all('*', async (context) => handle(context, prefix))
  app.onError((error, context) => sendUnexpectedError(context, error))

  const server = serve({ fetch: app.fetch, port: 0, hostname: HOST }) as Server
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Agent backend did not bind a TCP port')

  const { port } = address
  return {
    baseUrl: `http://${HOST}:${port}${prefix}`,
    port,
    close: () => closeServer(server),
  }
}

export async function readJsonBody(context: Context): Promise<unknown> {
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

function sendError(context: Context, status: number, code: string, message: string): Response {
  return context.json({ error: { code, message } }, status as ContentfulStatusCode)
}

function sendUnexpectedError(context: Context, error: unknown): Response {
  if (error instanceof BotError) return sendError(context, error.status, 'bot_error', error.message)
  if (error instanceof HttpError) {
    return sendError(context, error.status, error.code, error.message)
  }
  const rawMessage = error instanceof Error ? error.message : ''
  if (/not found/i.test(rawMessage)) {
    return sendError(context, 404, 'not_found', 'Thread not found.')
  }
  if (/(running|active run|invalid state|cannot .* while|busy|target already exists)/i.test(rawMessage)) {
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
