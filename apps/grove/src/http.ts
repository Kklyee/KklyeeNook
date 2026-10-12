import { once } from 'node:events'
import type { Server } from 'node:http'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { serve } from '@hono/node-server'
import { Type, type Static, type TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { SOCIAL_ACTIONS } from '@kklyeenook/shared/bot/social'
import { GroveStore, GroveError } from './store'
import { GroveRelay } from './relay'

const id = Type.String({ minLength: 1, maxLength: 200 })
const text = Type.String({ minLength: 1, maxLength: 64000 })
const strict = { additionalProperties: false }
const grantSchema = Type.Object(
  {
    subject: Type.Object(
      { type: Type.Union([Type.Literal('user'), Type.Literal('bot')]), id },
      strict,
    ),
    targetBotId: id,
    actions: Type.Array(Type.Union(SOCIAL_ACTIONS.map((action) => Type.Literal(action))), {
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
    }),
    constraints: Type.Optional(
      Type.Object(
        {
          allowedToolIds: Type.Optional(Type.Array(id, { maxItems: 100 })),
          allowedMcpServers: Type.Optional(Type.Array(id, { maxItems: 100 })),
          maxUses: Type.Optional(Type.Integer({ minimum: 1 })),
          expiresAt: Type.Optional(Type.Integer({ minimum: 1 })),
        },
        strict,
      ),
    ),
  },
  strict,
)
const sendSchema = Type.Object(
  {
    operationId: id,
    fromBotId: id,
    toBotId: id,
    type: Type.Union([Type.Literal('message'), Type.Literal('task')]),
    content: text,
    task: Type.Optional(
      Type.Object(
        {
          taskId: id,
          chainId: id,
          depth: Type.Integer({ minimum: 1, maximum: 1 }),
          deadline: Type.Integer({ minimum: 1 }),
        },
        strict,
      ),
    ),
  },
  strict,
)

function token(context: Context) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(context.req.header('authorization') ?? '')
  if (!match) throw new GroveError(401, 'Bearer credential required')
  return match[1]!
}

async function parse<T extends TSchema>(context: Context, schema: T): Promise<Static<T>> {
  let input: unknown
  try {
    input = await context.req.json()
  } catch {
    throw new GroveError(400, 'Invalid JSON body')
  }
  if (!Value.Check(schema, input)) throw new GroveError(400, 'Invalid request input')
  return input as Static<T>
}

export function createGroveApp(store: GroveStore, relay: GroveRelay) {
  const app = new Hono()
  app.use(
    '*',
    bodyLimit({
      maxSize: 256_000,
      onError: (context) => context.json({ error: 'Request body is too large' }, 413),
    }),
  )
  app.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    if (context.req.header('origin'))
      return context.json({ error: 'Browser origins are not supported by the Relay' }, 403)
    await next()
    return undefined
  })
  app.get('/health', (context) => context.json({ ok: true, service: 'grove' }))
  app.get('/me', async (context) =>
    context.json({ userId: await store.authenticateUser(token(context)) }),
  )
  app.get('/host', async (context) => context.json(await store.authenticateHost(token(context))))
  app.post('/hosts', async (context) =>
    context.json(
      await store.registerHost(
        token(context),
        (
          await parse(
            context,
            Type.Object({ name: Type.String({ minLength: 1, maxLength: 100 }) }, strict),
          )
        ).name,
      ),
      201,
    ),
  )
  app.delete('/hosts/:id', async (context) => {
    await store.disableHost(token(context), context.req.param('id'))
    return context.body(null, 204)
  })
  app.post('/bots', async (context) => {
    const input = await parse(
      context,
      Type.Object({ localBotId: id, name: Type.String({ minLength: 1, maxLength: 100 }) }, strict),
    )
    return context.json(await store.registerBot(token(context), input.localBotId, input.name), 201)
  })
  app.post('/grants', async (context) =>
    context.json(await store.createGrant(token(context), await parse(context, grantSchema)), 201),
  )
  app.get('/connections', async (context) => context.json(await store.connections(token(context))))
  app.get('/host/bots', async (context) => context.json(await store.hostDirectory(token(context))))
  app.post('/relationships', async (context) =>
    context.json(
      await store.invite(
        token(context),
        (await parse(context, Type.Object({ recipientUserId: id }, strict))).recipientUserId,
      ),
      201,
    ),
  )
  app.post('/relationships/:id/decision', async (context) =>
    context.json(
      await store.decideRelationship(
        token(context),
        context.req.param('id'),
        (
          await parse(
            context,
            Type.Object(
              {
                state: Type.Union([
                  Type.Literal('accepted'),
                  Type.Literal('rejected'),
                  Type.Literal('revoked'),
                ]),
              },
              strict,
            ),
          )
        ).state,
      ),
    ),
  )
  app.delete('/grants/:id', async (context) => {
    await store.revokeGrant(token(context), context.req.param('id'))
    return context.body(null, 204)
  })
  app.post('/messages', async (context) =>
    context.json(await relay.send(token(context), await parse(context, sendSchema)), 202),
  )
  app.get('/inbox', async (context) => context.json(await relay.inbox(token(context))))
  app.post('/inbox/:id/ack', async (context) => {
    await relay.acknowledge(token(context), context.req.param('id'))
    return context.body(null, 204)
  })
  app.post('/operations/:id/authorize', async (context) =>
    context.json(await store.revalidate(token(context), context.req.param('id'))),
  )
  app.post('/operations/:id/result', async (context) => {
    const outcome = await parse(
      context,
      Type.Object(
        {
          status: Type.Union([
            Type.Literal('completed'),
            Type.Literal('failed'),
            Type.Literal('rejected'),
          ]),
          result: Type.String({ maxLength: 64000 }),
        },
        strict,
      ),
    )
    return context.json(await relay.result(token(context), context.req.param('id'), outcome))
  })
  app.onError((error, context) =>
    error instanceof GroveError
      ? context.json({ error: error.message }, error.status)
      : context.json({ error: 'Grove operation failed' }, 500),
  )
  return app
}

export async function startGroveServer(
  store: GroveStore,
  relay: GroveRelay,
  options: { hostname?: string; port?: number } = {},
) {
  const server = serve({
    fetch: createGroveApp(store, relay).fetch,
    hostname: options.hostname ?? '127.0.0.1',
    port: options.port ?? 43128,
  }) as Server
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Grove failed to bind TCP port')
  let closing: Promise<void> | undefined
  return {
    port: address.port,
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })),
  }
}
