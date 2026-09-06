export interface CredentialStore {
  getApiKey(provider: string): string | undefined

  setApiKey(provider: string, apiKey: string): void

  hasApiKey(provider: string): boolean

  deleteApiKey(provider: string): void
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
}
