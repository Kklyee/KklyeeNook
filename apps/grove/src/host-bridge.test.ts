import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { GroveDatabase } from './database'
import { GroveStore } from './store'
import { GroveRelay } from './relay'
import { startGroveServer } from './http'
import { testHostProcess } from './testing/host-process'

let database: PGlite
let store: GroveStore
let server: Awaited<ReturnType<typeof startGroveServer>>
let relay: GroveRelay
const hosts: Awaited<ReturnType<typeof testHostProcess>>[] = []

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
  server = await startGroveServer(store, relay, { port: 0 })
})

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()))
  await server.close()
  await database.close()
})

async function fixture() {
  const alice = await store.provisionUser('Alice')
  const bob = await store.provisionUser('Bob')
  const aliceDevice = await store.registerHost(alice.token, 'Alice PC')
  const bobDevice = await store.registerHost(bob.token, 'Bob PC')
  const url = `http://127.0.0.1:${server.port}`
  const source = await testHostProcess(url, aliceDevice.token, 'alice-model', 'Alice summary')
  hosts.push(source)
  const target = await testHostProcess(url, bobDevice.token, 'bob-model', 'Independent Bob result')
  hosts.push(target)
  await source.syncNetwork()
  await target.syncNetwork()
  const sender = (await source.identities()).find((identity) => identity.localBotId === 'xiaoya')!
  const receiver = (await target.identities()).find((identity) => identity.localBotId === 'coder')!
  const invite = await store.invite(alice.token, bob.id)
  await store.decideRelationship(bob.token, invite.id, 'accepted')
  await source.syncNetwork()
  await target.syncNetwork()
  const grant = await store.createGrant(bob.token, {
    subject: { type: 'bot', id: sender.networkId },
    targetBotId: receiver.networkId,
    actions: ['message.send', 'task.request'],
  })
  return { alice, bob, source, target, sender, receiver, grant }
}

test('two independent Hosts execute a granted remote task and return a Durable result without leaking private context', async () => {
  const { source, target, receiver } = await fixture()
  const privateThread = await target.privateContext()
  const task = await source.requestTask({
    toBotId: receiver.networkId,
    instruction: 'Review this public design description',
    operationId: 'remote-review',
  })
  await viWait(async () => expect((await source.task(task.id)).status).toBe('completed'))
  expect((await source.task(task.id)).result).toBe('Independent Bob result')
  await viWait(async () =>
    expect(JSON.stringify(await source.snapshot(task.sourceThreadId))).toContain('Alice summary'),
  )
  const requests = await target.requests()
  expect(requests.some((request) => request.model === 'bob-model')).toBe(true)
  expect(JSON.stringify(requests)).toContain('BOB_TARGET_INSTRUCTIONS')
  expect(JSON.stringify(requests)).not.toContain('BOB_PRIVATE_MEMORY')
  expect(JSON.stringify(requests)).not.toContain('BOB_PRIVATE_CHAT')
  const incoming = (await target.tasks()).find((task) => task.remote?.direction === 'incoming')!
  expect(incoming.targetThreadId).not.toBe(privateThread)
  expect((await target.thread(incoming.targetThreadId!)).workspaceId).toBeNull()
  await source.restart()
  expect(
    (
      await source.requestTask({
        toBotId: receiver.networkId,
        instruction: task.instruction,
        operationId: 'remote-review',
      })
    ).id,
  ).toBe(task.id)
  expect(
    (await source.tasks()).filter((task) => task.remote?.direction === 'outgoing'),
  ).toHaveLength(1)
}, 45_000)

test('an offline receiving Host restores its Inbox without duplicate tasks or submissions', async () => {
  const { source, target, receiver } = await fixture()
  await target.stop()
  const task = await source.requestTask({
    toBotId: receiver.networkId,
    instruction: 'Queued remote review',
    operationId: 'offline-review',
  })
  await viWait(async () =>
    expect((await source.outbox()).find((entry) => entry.taskId === task.id)?.state).toBe('sent'),
  )
  await target.resume()
  await viWait(async () => expect((await source.task(task.id)).status).toBe('completed'))
  const incoming = (await target.tasks()).find((task) => task.remote?.direction === 'incoming')!
  const submissionId = incoming.submissionId
  await target.restart()
  await target.syncNetwork()
  expect((await target.task(incoming.id)).submissionId).toBe(submissionId)
  expect(await target.tasks()).toHaveLength(1)
  expect((await target.inbox()).filter((row) => row.envelope.message.type === 'task')).toHaveLength(
    1,
  )
}, 45_000)

test('revoking authorization while the target is offline prevents model execution after process recovery', async () => {
  const { bob, source, target, receiver, grant } = await fixture()
  await target.stop()
  const task = await source.requestTask({
    toBotId: receiver.networkId,
    instruction: 'Revoked task',
    operationId: 'revoked-review',
  })
  await viWait(async () =>
    expect((await source.outbox()).find((entry) => entry.taskId === task.id)?.state).toBe('sent'),
  )
  await store.revokeGrant(bob.token, grant.id)
  await target.resume()
  await viWait(async () => expect((await source.task(task.id)).status).toBe('rejected'))
  expect(await target.requests()).toEqual([])
  expect(await target.tasks()).toEqual([])
}, 45_000)

test('a local reception policy rejects granted remote tasks and ordinary messages never run a model', async () => {
  const { source, target, receiver } = await fixture()
  await target.setPolicy('coder', true, false)
  const task = await source.requestTask({
    toBotId: receiver.networkId,
    instruction: 'Local policy blocks',
    operationId: 'local-policy',
  })
  await viWait(async () => expect((await source.task(task.id)).status).toBe('rejected'))
  await source.sendMessage({
    toBotId: receiver.networkId,
    content: 'Hello without model',
    operationId: 'ordinary',
  })
  await viWait(async () =>
    expect(
      (await target.inbox()).some(
        (row) => row.envelope.message.type === 'message' && row.processedAt !== null,
      ),
    ).toBe(true),
  )
  expect(await target.requests()).toEqual([])
}, 45_000)

test('a pending Outbox survives sender process restart and a Relay outage', async () => {
  const { source, receiver } = await fixture()
  const port = server.port
  await server.close()
  const task = await source.requestTask({
    toBotId: receiver.networkId,
    instruction: 'Retry after outage',
    operationId: 'outbox-recovery',
  })
  await viWait(async () =>
    expect((await source.outbox()).find((entry) => entry.taskId === task.id)?.state).toBe(
      'pending',
    ),
  )
  await source.restart()
  expect((await source.outbox()).find((entry) => entry.taskId === task.id)?.state).toBe('pending')
  server = await startGroveServer(store, relay, { port })
  await viWait(async () => expect((await source.task(task.id)).status).toBe('completed'))
  expect((await source.outbox()).filter((entry) => entry.taskId === task.id)).toHaveLength(1)
}, 45_000)

test('running Hosts can pause and resume Grove without re-enrolling a device', async () => {
  const { source, receiver } = await fixture()
  const before = await source.identities()
  await source.network(false)
  await expect(
    source.requestTask({
      toBotId: receiver.networkId,
      instruction: 'Disabled request',
      operationId: 'disabled',
    }),
  ).rejects.toThrow('not configured')
  await source.network(true)
  const task = await source.requestTask({
    toBotId: receiver.networkId,
    instruction: 'Resumed collaboration',
    operationId: 'resumed',
  })
  await viWait(async () => expect((await source.task(task.id)).status).toBe('completed'))
  expect((await source.identities()).map((bot) => bot.networkId)).toEqual(
    before.map((bot) => bot.networkId),
  )
}, 45_000)

const viWait = (assertion: () => void | Promise<void>) =>
  vi.waitFor(assertion, { timeout: 25_000, interval: 100 })

test('a delegated MCP installs once, enables only target Bot tools and survives a full Host restart', async () => {
  const { alice, bob, target, receiver } = await fixture()
  const server = {
    id: 'design',
    name: 'Design MCP',
    url: 'https://mcp.example.com/design',
    requiresCredentials: false,
  }
  await target.catalog(server)
  await store.createGrant(bob.token, {
    subject: { type: 'user', id: alice.id },
    targetBotId: receiver.networkId,
    actions: ['tool.install'],
    constraints: { allowedMcpServers: ['design'], maxUses: 1 },
  })
  const input = {
    operationId: 'install-design',
    targetBotId: receiver.networkId,
    action: 'tool.install' as const,
    server,
  }
  const request = await store.capabilities.request(alice.token, input)
  await viWait(async () =>
    expect(
      (await target.capabilities()).find((entry) => entry.operation.id === request.operation.id)
        ?.operation.state,
    ).toBe('completed'),
  )
  const installed = await target.installed()
  expect(installed.servers).toHaveLength(1)
  expect(installed.bots.find((bot) => bot.id === 'coder')!.enabledTools).toContain(
    'mcp__design__inspect',
  )
  expect(installed.bots.find((bot) => bot.id === 'xiaoya')!.enabledTools).not.toContain(
    'mcp__design__inspect',
  )
  await target.restart()
  await target.syncNetwork()
  expect((await target.installed()).servers).toHaveLength(1)
  expect((await target.installed()).bots.find((bot) => bot.id === 'coder')!.enabledTools).toContain(
    'mcp__design__inspect',
  )
  expect((await store.capabilities.request(alice.token, input)).operation.id).toBe(
    request.operation.id,
  )
}, 45_000)

test('new MCP proposals require local owner approval and credential requests never auto-connect', async () => {
  const { alice, bob, target, receiver } = await fixture()
  const grant = await store.createGrant(bob.token, {
    subject: { type: 'user', id: alice.id },
    targetBotId: receiver.networkId,
    actions: ['tool.propose'],
  })
  const server = {
    id: 'proposal',
    name: 'Proposed MCP',
    url: 'https://mcp.example.com/proposal',
    requiresCredentials: false,
  }
  const proposed = await store.capabilities.request(alice.token, {
    operationId: 'propose',
    targetBotId: receiver.networkId,
    action: 'tool.propose',
    server,
  })
  await viWait(async () =>
    expect(
      (await target.capabilities()).find((entry) => entry.operation.id === proposed.operation.id)
        ?.operation.state,
    ).toBe('awaiting_approval'),
  )
  expect((await target.installed()).servers).toEqual([])
  await target.decideCapability(proposed.operation.id, true)
  await viWait(async () =>
    expect(
      (await target.capabilities()).find((entry) => entry.operation.id === proposed.operation.id)
        ?.operation.state,
    ).toBe('completed'),
  )
  const privateRequest = await store.capabilities.request(alice.token, {
    operationId: 'private',
    targetBotId: receiver.networkId,
    action: 'tool.propose',
    server: { ...server, id: 'private', requiresCredentials: true },
  })
  await viWait(async () =>
    expect(
      (await target.capabilities()).find(
        (entry) => entry.operation.id === privateRequest.operation.id,
      )?.operation.state,
    ).toBe('awaiting_approval'),
  )
  await target.decideCapability(privateRequest.operation.id, true)
  expect((await target.installed()).servers).toHaveLength(1)
  await store.revokeGrant(bob.token, grant.id)
  await viWait(async () =>
    expect(
      (await target.capabilities()).find(
        (entry) => entry.operation.id === privateRequest.operation.id,
      )?.operation.state,
    ).toBe('rejected'),
  )
}, 45_000)
