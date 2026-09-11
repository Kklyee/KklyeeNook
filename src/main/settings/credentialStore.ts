import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface CredentialEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface CredentialStore {
  getApiKey(provider: string): string | undefined

  setApiKey(provider: string, apiKey: string): void

  hasApiKey(provider: string): boolean

  deleteApiKey(provider: string): void

  isPersistenceAvailable(): boolean
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly keys = new Map<string, string>()

  getApiKey(provider: string): string | undefined {
    return this.keys.get(provider)
  }

  setApiKey(provider: string, apiKey: string): void {
    const value = apiKey.trim()

    if (!value) {
      throw new Error(`API Key 不能为空: ${provider}`)
    }

    this.keys.set(provider, value)
  }

  hasApiKey(provider: string): boolean {
    return this.keys.has(provider)
  }

  deleteApiKey(provider: string): void {
    this.keys.delete(provider)
  }

  isPersistenceAvailable(): boolean {
    return false
  }
}

export class PersistentCredentialStore implements CredentialStore {
  private readonly volatileKeys = new Map<string, string>()
  private encryptedKeys: Record<string, string> = {}

  constructor(
    private readonly storagePath: string,
    private readonly encryption: CredentialEncryption,
  ) {
    this.encryptedKeys = this.load()
  }

  getApiKey(provider: string): string | undefined {
    const volatile = this.volatileKeys.get(provider)
    if (volatile !== undefined) return volatile
    const encrypted = this.encryptedKeys[provider]
    if (!encrypted || !this.encryption.isEncryptionAvailable()) return undefined
    try {
      return this.encryption.decryptString(Buffer.from(encrypted, 'base64'))
    } catch (error) {
      console.warn(`[CredentialStore] failed to decrypt credentials for ${provider}:`, error)
      return undefined
    }
  }

  setApiKey(provider: string, apiKey: string): void {
    const value = apiKey.trim()
    if (!value) throw new Error(`API Key 不能为空: ${provider}`)

    if (!this.encryption.isEncryptionAvailable()) {
      this.volatileKeys.set(provider, value)
      return
    }

    this.volatileKeys.delete(provider)
    this.encryptedKeys[provider] = this.encryption.encryptString(value).toString('base64')
    this.persist()
  }

  hasApiKey(provider: string): boolean {
    return this.getApiKey(provider) !== undefined
  }

  deleteApiKey(provider: string): void {
    this.volatileKeys.delete(provider)
    if (!(provider in this.encryptedKeys)) return
    delete this.encryptedKeys[provider]
    this.persist()
  }

  isPersistenceAvailable(): boolean {
    return this.encryption.isEncryptionAvailable()
  }

  private load(): Record<string, string> {
    if (!existsSync(this.storagePath)) return {}
    try {
      const value: unknown = JSON.parse(readFileSync(this.storagePath, 'utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    } catch (error) {
      console.warn('[CredentialStore] failed to load persisted credentials:', error)
      return {}
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.storagePath), { recursive: true })
    writeFileSync(this.storagePath, JSON.stringify(this.encryptedKeys), 'utf8')
  }
}
