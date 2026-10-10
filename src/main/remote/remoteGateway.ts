import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { bodyLimit } from 'hono/body-limit'
import { authorizeRemote, type RemoteIdentityPolicy } from './remoteAuth'
import { RemoteError, type RemoteAgentPort } from './remoteAgentPort'
import type { RemoteApprovalResponse, RemoteQueueMutation } from '@kklyeenook/shared/remote/index'
import { PERMISSION_MODES, type PermissionMode } from '@kklyeenook/shared/approval/permission'
import { REMOTE_MESSAGE_MAX_BYTES } from '@kklyeenook/shared/remote/attachments'
import { validateRemoteAttachments } from './remoteAttachments'

export const REMOTE_HOST = '127.0.0.1'
export const REMOTE_PORT = 43127

export interface RemoteGatewayOptions {
  staticRoot: string
  identity(): RemoteIdentityPolicy
  port?: number
}
export interface RunningRemoteGateway {
  port: number
  close(): Promise<void>
}

const text = (body: Record<string, unknown>, key: string): string => {
  if (typeof body[key] !== 'string' || !body[key].trim()) throw new RemoteError(400, `${key} is required`)
  return body[key] as string
}
const integer = (body: Record<string, unknown>, key: string): number => {
  if (!Number.isInteger(body[key]) || (body[key] as number) < 0) throw new RemoteError(400, `${key} is invalid`)
  return body[key] as number
}
async function body(context: Context): Promise<Record<string, unknown>> {
  if (!context.req.header('content-type')?.startsWith('application/json')) throw new RemoteError(400, 'JSON body is required')
  const value: unknown = await context.req.json().catch(() => { throw new RemoteError(400, 'Invalid JSON') })
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteError(400, 'JSON object is required')
  if ((!Array.isArray((value as Record<string, unknown>).attachments) || !(value as { attachments: unknown[] }).attachments.length) && Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) throw new RemoteError(413, 'Request too large')
  return value as Record<string, unknown>
}
const messageText = (input: Record<string, unknown>, key: string) => typeof input[key] === 'string' && ((input[key] as string).trim() || (Array.isArray(input.attachments) && input.attachments.length)) ? input[key] as string : text(input, key)
const permission = (input: Record<string, unknown>) => {
  const mode = text(input, 'permission') as PermissionMode
  if (!PERMISSION_MODES.includes(mode)) throw new RemoteError(400, 'Invalid permission')
  return mode
}

export function createRemoteGatewayApp(port: RemoteAgentPort, options: RemoteGatewayOptions) {
  const app = new Hono()
  const assets = new Map<string, { data: Buffer; gzip: Buffer }>()
  app.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    context.header('X-Content-Type-Options', 'nosniff')
    context.header('Referrer-Policy', 'no-referrer')
    context.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    const denied = authorizeRemote(context, options.identity())
    if (denied) return context.json({ error: denied === 401 ? 'Tailscale identity required' : 'Access denied' }, denied)
    return next()
  })
  app.use('/api/*', (context, next) => bodyLimit({ maxSize: /^\/api\/(?:projects\/[^/]+\/conversations|conversations\/[^/]+\/messages)$/.test(context.req.path) ? REMOTE_MESSAGE_MAX_BYTES : 64 * 1024, onError: context => context.json({ error: 'Request too large' }, 413) })(context, next))
  app.get('/api/state', async context => context.json(await port.getState()))
  app.get('/api/models', async context => context.json(await port.listModels()))
  app.get('/api/projects', async context => context.json(await port.listProjects()))
  app.get('/api/projects/:id', async context => context.json(await port.getProject(context.req.param('id'))))
  app.get('/api/projects/:id/conversations', async context => context.json(await port.listConversations(context.req.param('id'))))
  app.post('/api/projects/:id/conversations', async context => {
    const input = await body(context)
    return context.json(await port.createConversation(context.req.param('id'), {
      permission: permission(input),
      provider: text(input, 'provider'),
      modelId: text(input, 'modelId'),
      thinkingLevel: text(input, 'thinkingLevel'),
      prompt: messageText(input, 'prompt'),
      ...(input.attachments === undefined ? {} : { attachments: validateRemoteAttachments(input.attachments) }),
    }), 201)
  })
  app.get('/api/conversations/:id', async context => context.json(await port.getConversation(context.req.param('id'))))
  app.post('/api/conversations/:id/continue', async context => context.json(await port.continueConversation(context.req.param('id'), text(await body(context), 'threadId')), 201))
  app.patch('/api/conversations/:id', async context => {
    await port.renameConversation(context.req.param('id'), text(await body(context), 'title'))
    return context.json({ ok: true })
  })
  app.post('/api/conversations/:id/messages', async context => {
    const input = await body(context)
    const mode = text(input, 'mode')
    if (mode !== 'normal' && mode !== 'followUp' && mode !== 'steer') throw new RemoteError(400, 'Invalid send mode')
    await port.sendMessage(context.req.param('id'), { content: messageText(input, 'content'), mode, ...(input.attachments === undefined ? {} : { attachments: validateRemoteAttachments(input.attachments) }) })
    return context.json({ ok: true })
  })
  app.post('/api/conversations/:id/cancel', async context => {
    await port.cancel(context.req.param('id'))
    return context.json({ ok: true })
  })
  app.post('/api/conversations/:id/permission', async context => {
    await port.setPermission(context.req.param('id'), permission(await body(context)))
    return context.json({ ok: true })
  })
  app.post('/api/conversations/:id/model', async context => {
    const input = await body(context)
    await port.setModel(context.req.param('id'), { provider: text(input, 'provider'), modelId: text(input, 'modelId') })
    return context.json({ ok: true })
  })
  app.post('/api/conversations/:id/thinking', async context => {
    await port.setThinkingLevel(context.req.param('id'), text(await body(context), 'thinkingLevel'))
    return context.json({ ok: true })
  })
  app.post('/api/conversations/:id/queue/clear', async context => {
    await port.clearQueue(context.req.param('id'))
    return context.json({ ok: true })
  })
  app.post('/api/conversations/:id/queue/item', async context => {
    const input = await body(context)
    const mode = text(input, 'mode')
    if (mode !== 'steer' && mode !== 'followUp') throw new RemoteError(400, 'Invalid queue mode')
    if (!Array.isArray(input.expected) || input.expected.some(item => typeof item !== 'string')) throw new RemoteError(400, 'Expected queue is required')
    const base = { mode, index: integer(input, 'index'), expected: input.expected as string[] } satisfies Pick<RemoteQueueMutation, 'mode' | 'index' | 'expected'>
    const action = text(input, 'action')
    let mutation: RemoteQueueMutation
    if (action === 'remove' || action === 'steer') mutation = { ...base, action }
    else if (action === 'edit') mutation = { ...base, action, value: text(input, 'value') }
    else if (action === 'move') mutation = { ...base, action, value: integer(input, 'value') }
    else throw new RemoteError(400, 'Invalid queue action')
    await port.updateQueue(context.req.param('id'), mutation)
    return context.json({ ok: true })
  })
  app.post('/api/approvals/:id/respond', async context => {
    const input = await body(context)
    const conversationId = text(input, 'conversationId')
    let response: RemoteApprovalResponse
    if (typeof input.confirmed === 'boolean') response = { conversationId, confirmed: input.confirmed }
    else if (typeof input.value === 'string') response = { conversationId, value: input.value }
    else if (input.dismissed === true) response = { conversationId, dismissed: true }
    else throw new RemoteError(400, 'Approval response is required')
    await port.respondToApproval(context.req.param('id'), response)
    return context.json({ ok: true })
  })
  app.get('/api/conversations/:id/events', async context => {
    await port.assertConversation(context.req.param('id'))
    context.header('X-Accel-Buffering', 'no')
    return streamSSE(context, async stream => {
      let writes = Promise.resolve()
      let finish!: () => void
      const ended = new Promise<void>(resolve => { finish = resolve })
      const unsubscribe = port.subscribe(context.req.param('id'), event => {
        writes = writes.then(async () => { await stream.writeSSE({ event: 'remote', data: JSON.stringify(event), id: String(event.seq) }) }).catch(finish)
      })
      const heartbeat = setInterval(() => {
        if (authorizeRemote(context, options.identity())) { finish(); void stream.close(); return }
        writes = writes.then(async () => { await stream.write(': heartbeat\n\n') }).catch(finish)
      }, 15_000)
      stream.onAbort(finish)
      try { await ended } finally { clearInterval(heartbeat); unsubscribe() }
    })
  })
  app.all('/api/*', context => context.json({ error: 'Not found' }, 404))
  app.get('*', async context => {
    const urlPath = context.req.path
    if (urlPath !== '/' && !['/index.html', '/manifest.webmanifest', '/sw.js', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(urlPath) && !/^\/assets\/[a-zA-Z0-9._-]+$/.test(urlPath)) return context.notFound()
    const root = resolve(options.staticRoot)
    const file = resolve(root, urlPath === '/' ? 'index.html' : urlPath.slice(1))
    if (!file.startsWith(root + sep)) return context.notFound()
    let asset = assets.get(file)
    if (!asset) {
      try {
        const data = await readFile(file)
        asset = { data, gzip: gzipSync(data) }
        if (urlPath.startsWith('/assets/')) assets.set(file, asset)
      } catch { return context.notFound() }
    }
    const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
    context.header('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
    context.header('Vary', 'Accept-Encoding')
    if (urlPath.startsWith('/assets/')) context.header('Cache-Control', 'private, max-age=31536000, immutable')
    const compressed = /\bgzip\b(?!\s*;\s*q=0(?:\D|$))/.test(context.req.header('accept-encoding') ?? '')
    if (compressed) context.header('Content-Encoding', 'gzip')
    return context.body(new Uint8Array(compressed ? asset.gzip : asset.data))
  })
  app.onError((error, context) => {
    if (error instanceof RemoteError) return context.json({ error: error.message }, error.status)
    const message = error instanceof Error ? error.message : ''
    if (/not found/i.test(message)) return context.json({ error: 'Conversation or approval not found' }, 404)
    if (/(busy|historical.*read-only|target already exists|already decided|no longer active|queue changed)/i.test(message)) return context.json({ error: 'Operation conflicts with the current conversation state' }, 409)
    console.error('[Remote Gateway]', error)
    return context.json({ error: 'Request failed' }, 500)
  })
  return app
}

export async function startRemoteGateway(port: RemoteAgentPort, options: RemoteGatewayOptions): Promise<RunningRemoteGateway> {
  const app = createRemoteGatewayApp(port, options)
  const server = serve({ fetch: app.fetch, hostname: REMOTE_HOST, port: options.port ?? REMOTE_PORT }) as Server
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Remote Gateway failed to bind')
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
