import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { GroveDatabase } from './database'
import { GroveStore } from './store'
import { GroveRelay } from './relay'
import { createGroveApp } from './http'

let database: PGlite
let store: GroveStore
let adapter: GroveDatabase
beforeEach(async () => {
  database = new PGlite()
  await database.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  adapter = {
    query: (sql, values) => database.query(sql, values),
    transaction: (action) =>
      database.transaction((connection) =>
        action({ query: (sql, values) => connection.query(sql, values) }),
      ),
  }
  store = new GroveStore(adapter)
})
afterEach(() => database.close())

test('remote tool invocation requires its own Bot grant, stable call ID and execution recheck', async () => {
  const { alice, bob, device, bot } = await fixture()
  const senderHost = await store.registerHost(alice.token, 'Alice PC')
  const sender = await store.registerBot(senderHost.token, 'coder', 'Coder')
  await store.createGrant(bob.token, {
    subject: { type: 'bot', id: sender.networkId },
    targetBotId: bot.networkId,
    actions: ['task.request'],
  })
  const relay = new GroveRelay(adapter, store)
  const task = await relay.send(senderHost.token, {
    operationId: 'task',
    fromBotId: sender.networkId,
    toBotId: bot.networkId,
    type: 'task',
    content: 'Use the public design tool',
    task: { taskId: 'task', chainId: 'chain', depth: 1, deadline: Date.now() + 60000 },
  })
  const app = createGroveApp(store, relay)
  const invoke = (token: string, callId: string, toolId = 'mcp__design__inspect') =>
    app.request(`/operations/${task.operation.id}/invoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ callId, toolId, mcpServerId: 'design' }),
    })
  expect((await invoke(device.token, 'call1')).status).toBe(403)
  const grant = await store.createGrant(bob.token, {
    subject: { type: 'bot', id: sender.networkId },
    targetBotId: bot.networkId,
    actions: ['tool.invoke'],
    constraints: {
      allowedToolIds: ['mcp__design__inspect'],
      allowedMcpServers: ['design'],
      maxUses: 1,
    },
  })
  expect((await invoke(senderHost.token, 'call1')).status).toBe(403)
  expect((await invoke(device.token, 'call1')).status).toBe(200)
  expect((await invoke(device.token, 'call1')).status).toBe(200)
  expect((await invoke(device.token, 'call2')).status).toBe(403)
  expect((await invoke(device.token, 'call1', 'mcp__design__delete')).status).toBe(409)
  await store.revokeGrant(bob.token, grant.id)
  expect((await invoke(device.token, 'call1')).status).toBe(403)
})

async function fixture() {
  const alice = await store.provisionUser('Alice')
  const bob = await store.provisionUser('Bob')
  const device = await store.registerHost(bob.token, 'Bob PC')
  const bot = await store.registerBot(device.token, 'designer', 'Designer')
  const server = {
    id: 'design',
    name: 'Design',
    url: 'https://mcp.example.com/design',
    requiresCredentials: false,
  }
  await store.capabilities.publish(device.token, bot.networkId, [server])
  const grant = await store.createGrant(bob.token, {
    subject: { type: 'user', id: alice.id },
    targetBotId: bot.networkId,
    actions: ['tool.install', 'tool.propose'],
    constraints: { allowedMcpServers: ['design'], maxUses: 2 },
  })
  return {
    alice,
    bob,
    device,
    bot,
    server,
    grant,
    input: {
      operationId: 'install',
      targetBotId: bot.networkId,
      action: 'tool.install' as const,
      server,
    },
  }
}

test('delegated install is limited to exact target catalog, idempotent and owner scoped', async () => {
  const { alice, bob, device, input, server } = await fixture()
  const first = await store.capabilities.request(alice.token, input)
  expect(await store.capabilities.request(alice.token, input)).toEqual(first)
  await expect(
    store.capabilities.request(alice.token, {
      ...input,
      operationId: 'alias',
      server: { ...server, url: 'https://attacker.example/mcp' },
    }),
  ).rejects.toThrow('catalog')
  await expect(
    store.capabilities.request(alice.token, {
      ...input,
      operationId: 'other',
      server: { ...server, id: 'other' },
    }),
  ).rejects.toThrow('Grant')
  const other = await store.registerHost(alice.token, 'Alice PC')
  await expect(
    store.capabilities.update(other.token, first.operation.id, 'installing'),
  ).rejects.toThrow('another Host')
  await store.revalidate(device.token, first.operation.id)
  await store.capabilities.update(device.token, first.operation.id, 'installing')
  await store.capabilities.update(device.token, first.operation.id, 'completed')
  expect(await store.capabilities.inbox(device.token)).toEqual([])
  expect((await store.capabilities.userOperations(bob.token))[0].operation.state).toBe('completed')
  await expect(
    store.capabilities.update(device.token, first.operation.id, 'rejected'),
  ).rejects.toThrow('already ended')
  expect((await database.query('SELECT * FROM network_operations')).rows).toHaveLength(1)
})

test('proposals wait for target owner; revoked grants fail execution recheck and secrets cannot be submitted', async () => {
  const { alice, bob, device, input, grant } = await fixture()
  const request = await store.capabilities.request(alice.token, {
    ...input,
    action: 'tool.propose',
  })
  await store.capabilities.update(device.token, request.operation.id, 'awaiting_approval')
  await store.revokeGrant(bob.token, grant.id)
  await expect(store.revalidate(device.token, request.operation.id)).rejects.toThrow('Grant')
  const db = {
    query: (sql: string, values?: unknown[]) => database.query(sql, values),
    transaction: async () => {
      throw new Error('unused')
    },
  } as GroveDatabase
  const app = createGroveApp(store, new GroveRelay(db, store))
  const response = await app.request('/capabilities', {
    method: 'POST',
    headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ...input,
      server: { ...input.server, env: { SECRET: 'do-not-copy' }, command: 'cmd.exe' },
    }),
  })
  expect(response.status).toBe(400)
  await expect(
    store.capabilities.request(alice.token, {
      ...input,
      server: { ...input.server, url: 'https://user:secret@example.com/mcp' },
    }),
  ).rejects.toThrow('endpoint')
})
