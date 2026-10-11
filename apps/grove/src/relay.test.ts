import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { GroveDatabase } from './database'
import type { RelayEnvelope } from '@kklyeenook/shared/bot/social'
import { GroveStore } from './store'
import { GroveRelay } from './relay'
import { createGroveApp, startGroveServer } from './http'

let database: PGlite
let store: GroveStore
let relay: GroveRelay
const servers: Array<{ close(): Promise<void> }> = []

beforeEach(async () => {
  database = new PGlite()
  await database.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  const adapter: GroveDatabase = {
    query: (sql, values) => database.query(sql, values),
    transaction: (action) =>
      database.transaction((connection) =>
        action({ query: (sql, values) => connection.query(sql, values) }),
      ),
  }
  store = new GroveStore(adapter)
  relay = new GroveRelay(adapter, store)
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await database.close()
})

async function fixture() {
  const alice = await store.provisionUser('Alice')
  const bob = await store.provisionUser('Bob')
  const senderHost = await store.registerHost(alice.token, 'Alice PC')
  const receiverHost = await store.registerHost(bob.token, 'Bob PC')
  const sender = await store.registerBot(senderHost.token, 'coder', 'Coder')
  const receiver = await store.registerBot(receiverHost.token, 'designer', 'Designer')
  const grant = await store.createGrant(bob.token, {
    subject: { type: 'bot', id: sender.networkId },
    targetBotId: receiver.networkId,
    actions: ['message.send', 'task.request'],
  })
  const input = {
    operationId: 'request-1',
    fromBotId: sender.networkId,
    toBotId: receiver.networkId,
    type: 'task' as const,
    content: 'Review the interface',
    task: { taskId: 'task-1', chainId: 'chain-1', depth: 1, deadline: Date.now() + 60_000 },
  }
  return { alice, bob, senderHost, receiverHost, sender, receiver, grant, input }
}

test('offline requests remain pending until acknowledged; retries preserve one operation and message', async () => {
  const { senderHost, receiverHost, sender, input } = await fixture()
  const sent = await relay.send(senderHost.token, input)
  expect(await relay.send(senderHost.token, input)).toEqual(sent)
  const inbox = await relay.inbox(receiverHost.token)
  expect(inbox).toHaveLength(1)
  expect(inbox[0]).toMatchObject({
    sender: { networkId: sender.networkId },
    sourceHostId: senderHost.id,
  })
  expect(await relay.inbox(receiverHost.token)).toEqual(inbox)
  await expect(relay.acknowledge(senderHost.token, sent.message.id)).rejects.toThrow('not found')
  await relay.acknowledge(receiverHost.token, sent.message.id)
  await relay.acknowledge(receiverHost.token, sent.message.id)
  expect(await relay.inbox(receiverHost.token)).toEqual([])
  expect((await database.query('SELECT * FROM network_operations')).rows).toHaveLength(1)
  expect((await database.query('SELECT * FROM network_messages')).rows).toHaveLength(1)
})

test('results return only to the original sender and cannot be duplicated or rewritten', async () => {
  const { senderHost, receiverHost, input } = await fixture()
  const sent = await relay.send(senderHost.token, input)
  await expect(
    relay.result(senderHost.token, sent.operation.id, { status: 'completed', result: 'spoof' }),
  ).rejects.toThrow('not found')
  const outcome = { status: 'completed' as const, result: 'Independent review' }
  const result = await relay.result(receiverHost.token, sent.operation.id, outcome)
  expect(await relay.result(receiverHost.token, sent.operation.id, outcome)).toEqual(result)
  await expect(
    relay.result(receiverHost.token, sent.operation.id, { ...outcome, result: 'changed' }),
  ).rejects.toThrow('different content')
  expect(result.message.correlationId).toBe(sent.operation.id)
  expect((await relay.inbox(senderHost.token))[0]?.outcome).toEqual(outcome)
  expect(await relay.inbox(receiverHost.token)).toEqual([])
  await relay.acknowledge(senderHost.token, result.message.id)
  expect(await relay.inbox(senderHost.token)).toEqual([])
})

test('revoked and expired requests are rejected before delivery and return a correlated failure', async () => {
  const { bob, senderHost, receiverHost, grant, input } = await fixture()
  const sent = await relay.send(senderHost.token, input)
  await store.revokeGrant(bob.token, grant.id)
  expect(await relay.inbox(receiverHost.token)).toEqual([])
  const replies = await relay.inbox(senderHost.token)
  expect(replies).toHaveLength(1)
  expect(replies[0]).toMatchObject({
    message: { correlationId: sent.operation.id },
    outcome: { status: 'rejected' },
  })
  expect((await database.query('SELECT state FROM network_operations')).rows[0]).toMatchObject({
    state: 'rejected',
  })
})

test('task deadlines and remote recursion limits are enforced, including queued tasks', async () => {
  const { senderHost, receiverHost, input } = await fixture()
  await expect(
    relay.send(senderHost.token, { ...input, task: { ...input.task, depth: 2 } }),
  ).rejects.toThrow('recursive')
  await expect(
    relay.send(senderHost.token, { ...input, task: { ...input.task, deadline: Date.now() - 1 } }),
  ).rejects.toThrow('time budget')
  const sent = await relay.send(senderHost.token, input)
  const expired = { ...sent, task: { ...sent.task!, deadline: Date.now() - 1 } }
  await database.query('UPDATE network_messages SET payload=$1 WHERE id=$2', [
    JSON.stringify({ message: sent.message, task: expired.task }),
    sent.message.id,
  ])
  expect(await relay.inbox(receiverHost.token)).toEqual([])
  expect((await relay.inbox(senderHost.token))[0]?.outcome?.result).toContain('time budget')
})

test('ordinary messages do not become tasks; invalid inputs cannot consume limited grants', async () => {
  const { bob, senderHost, receiverHost, sender, receiver, grant, input } = await fixture()
  await store.revokeGrant(bob.token, grant.id)
  await store.createGrant(bob.token, {
    subject: { type: 'bot', id: sender.networkId },
    targetBotId: receiver.networkId,
    actions: ['message.send'],
    constraints: { maxUses: 1 },
  })
  const message = {
    operationId: 'hello',
    fromBotId: sender.networkId,
    toBotId: receiver.networkId,
    type: 'message' as const,
    content: 'Hello',
  }
  await expect(relay.send(senderHost.token, { ...message, task: input.task })).rejects.toThrow(
    'cannot carry',
  )
  const sent = await relay.send(senderHost.token, message)
  expect((await relay.inbox(receiverHost.token))[0]?.message.type).toBe('message')
  await expect(
    relay.result(receiverHost.token, sent.operation.id, { status: 'completed', result: 'answer' }),
  ).rejects.toThrow('not found')
  await relay.acknowledge(receiverHost.token, sent.message.id)
  expect(
    (await database.query<{ state: string }>('SELECT state FROM network_operations')).rows[0]
      ?.state,
  ).toBe('completed')
})

test('real HTTP routes authenticate Host requests and reject forged identity and grant fields', async () => {
  const { senderHost, receiverHost, input } = await fixture()
  const server = await startGroveServer(store, relay, { port: 0 })
  servers.push(server)
  const request = (path: string, token: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  expect((await request('/messages', 'invalid', input)).status).toBe(401)
  expect(
    (await request('/messages', senderHost.token, { ...input, ownerUserId: 'fake' })).status,
  ).toBe(400)
  const response = await request('/messages', senderHost.token, input)
  expect(response.status).toBe(202)
  const sent = (await response.json()) as RelayEnvelope
  const inbox = (await (await request('/inbox', receiverHost.token)).json()) as RelayEnvelope[]
  expect(inbox[0]?.message.id).toBe(sent.message.id)
  expect((await request(`/inbox/${sent.message.id}/ack`, receiverHost.token, {})).status).toBe(204)
  expect(
    (await request(`/operations/${sent.operation.id}/authorize`, senderHost.token, {})).status,
  ).toBe(403)
  expect(
    (
      await request(`/operations/${sent.operation.id}/result`, receiverHost.token, {
        status: 'completed',
        result: 'review done',
      })
    ).status,
  ).toBe(200)
})

test('HTTP validation limits body size and User credentials cannot act as Host credentials', async () => {
  const { alice, senderHost, input } = await fixture()
  const app = createGroveApp(store, relay)
  const headers = { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' }
  expect(
    (await app.request('/messages', { method: 'POST', headers, body: JSON.stringify(input) }))
      .status,
  ).toBe(401)
  expect(
    (await app.request('/messages', { method: 'POST', headers, body: 'x'.repeat(256_001) })).status,
  ).toBe(413)
  expect(
    (
      await app.request('/messages', {
        method: 'POST',
        headers: { ...headers, authorization: `Bearer ${senderHost.token}` },
        body: '{',
      })
    ).status,
  ).toBe(400)
  expect(
    (await app.request('/health', { headers: { origin: 'https://unknown.test' } })).status,
  ).toBe(403)
})

test('remote queues and message rates are bounded without recording rejected side effects', async () => {
  const { senderHost, receiverHost, input } = await fixture()
  for (let index = 0; index < 4; index++)
    await relay.send(senderHost.token, {
      ...input,
      operationId: `queue:${index}`,
      task: { ...input.task, taskId: `task:${index}` },
    })
  await expect(relay.send(senderHost.token, { ...input, operationId: 'overflow' })).rejects.toThrow(
    'queue is full',
  )
  expect((await database.query('SELECT * FROM network_operations')).rows).toHaveLength(4)
  const pending = await relay.inbox(receiverHost.token)
  await relay.result(receiverHost.token, pending[0]!.operation.id, {
    status: 'completed',
    result: 'done',
  })
  await relay.send(senderHost.token, { ...input, operationId: 'after-finish' })
  for (let index = 0; index < 25; index++)
    await relay.send(senderHost.token, {
      operationId: `message:${index}`,
      fromBotId: input.fromBotId,
      toBotId: input.toBotId,
      type: 'message',
      content: 'hello',
    })
  await expect(
    relay.send(senderHost.token, {
      operationId: 'rate-overflow',
      fromBotId: input.fromBotId,
      toBotId: input.toBotId,
      type: 'message',
      content: 'hello',
    }),
  ).rejects.toThrow('rate limit')
  expect((await database.query('SELECT * FROM network_operations')).rows).toHaveLength(30)
}, 15_000)

test('a restarted Relay resumes the same persisted Inbox and results need no reverse Grant', async () => {
  const { bob, senderHost, receiverHost, grant, input } = await fixture()
  const sent = await relay.send(senderHost.token, input)
  const adapter: GroveDatabase = {
    query: (sql, values) => database.query(sql, values),
    transaction: (action) =>
      database.transaction((connection) =>
        action({ query: (sql, values) => connection.query(sql, values) }),
      ),
  }
  const restarted = new GroveRelay(adapter, new GroveStore(adapter))
  expect((await restarted.inbox(receiverHost.token))[0]?.message.id).toBe(sent.message.id)
  await restarted.acknowledge(receiverHost.token, sent.message.id)
  await store.revokeGrant(bob.token, grant.id)
  await restarted.result(receiverHost.token, sent.operation.id, {
    status: 'completed',
    result: 'Already authorized work completed',
  })
  expect((await restarted.inbox(senderHost.token))[0]?.message.correlationId).toBe(
    sent.operation.id,
  )
  expect((await database.query('SELECT * FROM network_operations')).rows).toHaveLength(1)
})
