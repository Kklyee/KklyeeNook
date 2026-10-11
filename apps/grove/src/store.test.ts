import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { GroveStore } from './store'
import type { GroveDatabase } from './database'

let database: PGlite
let store: GroveStore

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
})

afterEach(async () => {
  await database.close()
})

async function fixture() {
  const alice = await store.provisionUser('Alice')
  const bob = await store.provisionUser('Bob')
  const aliceHost = await store.registerHost(alice.token, 'Alice PC')
  const bobHost = await store.registerHost(bob.token, 'Bob PC')
  const coder = await store.registerBot(aliceHost.token, 'coder', 'Coder')
  const designer = await store.registerBot(bobHost.token, 'coder', 'Coder')
  return { alice, bob, aliceHost, bobHost, coder, designer }
}

test('network identities distinguish same local Bot IDs and Host credentials cannot impersonate other devices', async () => {
  const { aliceHost, bobHost, coder, designer } = await fixture()
  expect(coder.networkId).not.toBe(designer.networkId)
  expect((await store.registerBot(aliceHost.token, 'coder', 'Renamed')).networkId).toBe(
    coder.networkId,
  )
  await expect(
    store.admit({
      token: aliceHost.token,
      fromBotId: designer.networkId,
      targetBotId: coder.networkId,
      action: 'message.send',
      operationId: 'spoof',
      payload: 'hello',
    }),
  ).rejects.toThrow('does not own')
  await expect(store.authenticateUser(aliceHost.token)).rejects.toThrow('authentication')
  await expect(store.authenticateHost('unknown')).rejects.toThrow('authentication')
  expect(await store.authenticateHost(bobHost.token)).toMatchObject({ id: bobHost.id })
})

test('User grants do not authorize a User’s Bots and only the target owner issues grants', async () => {
  const { alice, bob, aliceHost, coder, designer } = await fixture()
  await expect(
    store.createGrant(alice.token, {
      subject: { type: 'bot', id: coder.networkId },
      targetBotId: designer.networkId,
      actions: ['task.request'],
    }),
  ).rejects.toThrow('owner')
  await store.createGrant(bob.token, {
    subject: { type: 'user', id: alice.id },
    targetBotId: designer.networkId,
    actions: ['task.request'],
  })
  await expect(
    store.admit({
      token: aliceHost.token,
      fromBotId: coder.networkId,
      targetBotId: designer.networkId,
      action: 'task.request',
      operationId: 'not-inherited',
      payload: 'review',
    }),
  ).rejects.toThrow('Social Grant')
  expect(
    await store.admit({
      token: alice.token,
      targetBotId: designer.networkId,
      action: 'task.request',
      operationId: 'user-task',
      payload: 'review',
    }),
  ).toMatchObject({ subject: { type: 'user', id: alice.id } })
})

test('stable operation IDs are idempotent and concurrent requests cannot exceed maxUses', async () => {
  const { bob, aliceHost, coder, designer } = await fixture()
  const grant = await store.createGrant(bob.token, {
    subject: { type: 'bot', id: coder.networkId },
    targetBotId: designer.networkId,
    actions: ['task.request'],
    constraints: { maxUses: 1 },
  })
  const input = {
    token: aliceHost.token,
    fromBotId: coder.networkId,
    targetBotId: designer.networkId,
    action: 'task.request' as const,
    operationId: 'one',
    payload: 'review',
  }
  const results = await Promise.allSettled([
    store.admit(input),
    store.admit({ ...input, operationId: 'two' }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  const successful = results[0].status === 'fulfilled' ? input : { ...input, operationId: 'two' }
  const first = await store.admit(successful)
  expect(first.grantId).toBe(grant.id)
  expect(await store.admit(successful)).toEqual(first)
  await expect(store.admit({ ...successful, payload: 'changed' })).rejects.toThrow(
    'different input',
  )
  expect((await database.query('SELECT * FROM network_operations')).rows).toHaveLength(1)
})

test('queued operations recheck expiry, revocation and target Host before execution', async () => {
  const { bob, aliceHost, bobHost, coder, designer } = await fixture()
  const grant = await store.createGrant(bob.token, {
    subject: { type: 'bot', id: coder.networkId },
    targetBotId: designer.networkId,
    actions: ['task.request'],
  })
  const operation = await store.admit({
    token: aliceHost.token,
    fromBotId: coder.networkId,
    targetBotId: designer.networkId,
    action: 'task.request',
    operationId: 'queued',
    payload: 'review',
  })
  await expect(store.revalidate(aliceHost.token, operation.id)).rejects.toThrow('another Host')
  expect(await store.revalidate(bobHost.token, operation.id)).toMatchObject({ id: operation.id })
  await store.revokeGrant(bob.token, grant.id)
  await expect(store.revalidate(bobHost.token, operation.id)).rejects.toThrow('Social Grant')
  expect(
    await store.admit({
      token: aliceHost.token,
      fromBotId: coder.networkId,
      targetBotId: designer.networkId,
      action: 'task.request',
      operationId: 'queued',
      payload: 'review',
    }),
  ).toMatchObject({ id: operation.id })
  await store.disableHost(bob.token, bobHost.id)
  await expect(store.authenticateHost(bobHost.token)).rejects.toThrow('authentication')
})

test('capability scopes do not permit arbitrary MCP installation or grant tool invocation', async () => {
  const { alice, bob, designer } = await fixture()
  await store.createGrant(bob.token, {
    subject: { type: 'user', id: alice.id },
    targetBotId: designer.networkId,
    actions: ['tool.install'],
    constraints: { allowedMcpServers: ['design-mcp'] },
  })
  const input = {
    token: alice.token,
    targetBotId: designer.networkId,
    action: 'tool.install' as const,
    operationId: 'install',
    payload: {},
  }
  await expect(store.admit({ ...input, mcpServerId: 'shell' })).rejects.toThrow('Social Grant')
  expect(await store.admit({ ...input, mcpServerId: 'design-mcp' })).toMatchObject({
    action: 'tool.install',
  })
  await expect(
    store.admit({
      ...input,
      action: 'tool.invoke',
      operationId: 'invoke',
      mcpServerId: 'design-mcp',
    }),
  ).rejects.toThrow('Social Grant')
})

test('expiry and disabled sending devices invalidate an already admitted operation', async () => {
  const { alice, bob, aliceHost, bobHost, coder, designer } = await fixture()
  const grant = await store.createGrant(bob.token, {
    subject: { type: 'bot', id: coder.networkId },
    targetBotId: designer.networkId,
    actions: ['task.request'],
    constraints: { expiresAt: Date.now() + 60_000 },
  })
  const operation = await store.admit({
    token: aliceHost.token,
    fromBotId: coder.networkId,
    targetBotId: designer.networkId,
    action: 'task.request',
    operationId: 'expires',
    payload: 'review',
  })
  await database.query('UPDATE social_grants SET definition=$1 WHERE id=$2', [
    JSON.stringify({ ...grant, constraints: { expiresAt: Date.now() - 1 } }),
    grant.id,
  ])
  await expect(store.revalidate(bobHost.token, operation.id)).rejects.toThrow('Social Grant')
  await database.query('UPDATE social_grants SET definition=$1 WHERE id=$2', [
    JSON.stringify(grant),
    grant.id,
  ])
  await store.disableHost(alice.token, aliceHost.id)
  await expect(store.revalidate(bobHost.token, operation.id)).rejects.toThrow('Sending Host')
})
