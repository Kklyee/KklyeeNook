import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { AgentConfigStore } from '../../agent/src/settings/agentConfigStore'
import {
  MemoryCredentialStore,
  PersistentCredentialStore,
} from '../../agent/src/settings/credentialStore'
import { GroveConnection } from '../../desktop/src/main/grove/connection'
import { GROVE_HOST_CREDENTIAL, GROVE_USER_CREDENTIAL } from '@kklyeenook/shared/bot/grove-settings'
import type { GroveDatabase } from './database'
import { GroveStore } from './store'
import { GroveRelay } from './relay'
import { startGroveServer } from './http'

let database: PGlite
let store: GroveStore
let server: Awaited<ReturnType<typeof startGroveServer>>
let directory: string
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().slice('encrypted:'.length),
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'grove-connect-'))
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
  server = await startGroveServer(store, new GroveRelay(adapter, store), { port: 0 })
})
afterEach(async () => {
  await server.close()
  await database.close()
  if (!directory.startsWith(join(tmpdir(), 'grove-connect-')))
    throw new Error('Unexpected test directory')
  await rm(directory, { recursive: true, force: true })
})

test('Desktop enrollment stores separate encrypted credentials, omits them from snapshots, and reuses Host identity after restart', async () => {
  const alice = await store.provisionUser('Alice')
  const configPath = join(directory, 'config.json')
  const credentialPath = join(directory, 'credentials.json')
  const config = new AgentConfigStore({ model: { provider: 'test', modelID: 'model' } }, configPath)
  const credentials = new PersistentCredentialStore(credentialPath, encryption)
  const backend = { request: vi.fn(async () => ({ enabled: true })) }
  const connection = new GroveConnection(config, credentials, backend)
  const relayUrl = `http://127.0.0.1:${server.port}`
  const status = await connection.configure({
    enabled: true,
    relayUrl,
    userToken: alice.token,
    hostName: 'Alice Desktop',
  })
  const hostToken = credentials.getApiKey(GROVE_HOST_CREDENTIAL)!
  expect(status).toMatchObject({
    userId: alice.id,
    hasUserCredential: true,
    hasHostCredential: true,
    enabled: true,
  })
  expect(JSON.stringify(status)).not.toContain(alice.token)
  expect(JSON.stringify(status)).not.toContain(hostToken)
  expect(await readFile(configPath, 'utf8')).not.toContain(alice.token)
  expect(await readFile(credentialPath, 'utf8')).not.toContain(hostToken)
  expect(backend.request).toHaveBeenCalledWith({
    action: 'grove:configure',
    settings: config.get().grove,
    hostToken,
  })
  expect(JSON.stringify(backend.request.mock.calls)).not.toContain(alice.token)
  const restored = new GroveConnection(
    new AgentConfigStore(undefined, configPath),
    new PersistentCredentialStore(credentialPath, encryption),
    backend,
  )
  expect((await restored.configure({ enabled: true, relayUrl })).hostId).toBe(status.hostId)
  expect((await database.query('SELECT * FROM host_devices')).rows).toHaveLength(1)
  expect((await restored.configure({ enabled: false, relayUrl })).enabled).toBe(false)
  expect((await restored.configure({ enabled: true, relayUrl })).hostId).toBe(status.hostId)
})

test('invalid credentials, insecure URLs, User switching and missing encryption cannot change connection identity', async () => {
  const alice = await store.provisionUser('Alice')
  const bob = await store.provisionUser('Bob')
  const config = new AgentConfigStore({ model: { provider: 'test', modelID: 'model' } })
  const credentials = new PersistentCredentialStore(join(directory, 'credentials.json'), encryption)
  const backend = { request: vi.fn(async () => ({ enabled: true })) }
  const connection = new GroveConnection(config, credentials, backend)
  const relayUrl = `http://127.0.0.1:${server.port}`
  await expect(
    connection.configure({ enabled: true, relayUrl: 'http://example.com', userToken: alice.token }),
  ).rejects.toThrow('HTTPS')
  await expect(
    connection.configure({ enabled: true, relayUrl, userToken: 'invalid' }),
  ).rejects.toThrow('authentication')
  await connection.configure({ enabled: true, relayUrl, userToken: alice.token })
  const before = config.get().grove
  await expect(
    connection.configure({ enabled: true, relayUrl, userToken: bob.token }),
  ).rejects.toThrow('another User')
  expect(config.get().grove).toEqual(before)
  expect(credentials.getApiKey(GROVE_USER_CREDENTIAL)).toBe(alice.token)
  const volatile = new GroveConnection(config, new MemoryCredentialStore(), backend)
  await expect(
    volatile.configure({ enabled: true, relayUrl, userToken: alice.token }),
  ).rejects.toThrow('encrypted credential')
})

test('backend configuration failure restores existing settings and credentials', async () => {
  const alice = await store.provisionUser('Alice')
  const config = new AgentConfigStore({ model: { provider: 'test', modelID: 'model' } })
  const credentials = new PersistentCredentialStore(join(directory, 'credentials.json'), encryption)
  const backend = { request: vi.fn(async () => ({ enabled: true })) }
  const connection = new GroveConnection(config, credentials, backend)
  const relayUrl = `http://127.0.0.1:${server.port}`
  await connection.configure({ enabled: true, relayUrl, userToken: alice.token })
  const previous = config.get()
  const token = credentials.getApiKey(GROVE_HOST_CREDENTIAL)
  backend.request.mockRejectedValueOnce(new Error('Backend unavailable'))
  await expect(connection.configure({ enabled: false, relayUrl })).rejects.toThrow(
    'Backend unavailable',
  )
  expect(config.get()).toEqual(previous)
  expect(credentials.getApiKey(GROVE_HOST_CREDENTIAL)).toBe(token)
})
