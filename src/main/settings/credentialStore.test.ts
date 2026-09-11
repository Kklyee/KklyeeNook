import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'

import type { CredentialEncryption } from './credentialStore'
import { PersistentCredentialStore } from './credentialStore'

const directory = mkdtempSync(join(tmpdir(), 'kklyeenook-credentials-'))
afterAll(() => rmSync(directory, { recursive: true }))

const encryption: CredentialEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`),
  decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
}

test('persists only encrypted API keys', () => {
  const path = join(directory, 'credentials.json')
  const store = new PersistentCredentialStore(path, encryption)
  store.setApiKey('test', 'secret-value')

  expect(readFileSync(path, 'utf8')).not.toContain('secret-value')
  expect(new PersistentCredentialStore(path, encryption).getApiKey('test')).toBe('secret-value')
})

test('keeps credentials in memory when operating-system encryption is unavailable', () => {
  const path = join(directory, 'volatile.json')
  const store = new PersistentCredentialStore(path, {
    ...encryption,
    isEncryptionAvailable: () => false,
  })
  store.setApiKey('test', 'temporary-secret')

  expect(store.getApiKey('test')).toBe('temporary-secret')
  expect(store.isPersistenceAvailable()).toBe(false)
  expect(() => readFileSync(path, 'utf8')).toThrow()
})
