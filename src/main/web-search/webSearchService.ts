import {
  WEB_SEARCH_TIMEOUT_MS,
  webSearchCredentialId,
  type WebSearchProviderName,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchSettings,
} from '@/shared/web-search/webSearch'
import type { CredentialStore } from '@/main/settings/credentialStore'
import { normalizeWebSearchRequest } from './normalizeWebSearch'
import { createWebSearchProvider } from './webSearchProvider'
import { WebSearchError } from './webSearchErrors'

export interface WebSearchServiceOptions {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class WebSearchService {
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly getSettings: () => WebSearchSettings,
    private readonly getCredentialStore: () => CredentialStore,
    options: WebSearchServiceOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? WEB_SEARCH_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  isAvailable(): boolean {
    const provider = this.getSettings().provider
    return (
      provider !== 'disabled' && this.getCredentialStore().hasApiKey(webSearchCredentialId(provider))
    )
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const provider = this.requireProvider()
    const normalized = normalizeWebSearchRequest(request)
    if (!normalized.query) throw new WebSearchError('web_search_failed')
    const adapter = createWebSearchProvider(provider, this.requireApiKey(provider), this.fetchImpl)
    return this.withDeadline(signal, (deadline) => adapter.search(normalized, deadline))
  }

  async testConnection(
    provider: WebSearchProviderName,
    apiKey?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const key = apiKey?.trim() || this.getCredentialStore().getApiKey(webSearchCredentialId(provider))
    if (!key) throw new WebSearchError('web_search_not_configured')
    const adapter = createWebSearchProvider(provider, key, this.fetchImpl)
    await this.withDeadline(signal, (deadline) => adapter.testConnection(deadline))
  }

  private requireProvider(): WebSearchProviderName {
    const provider = this.getSettings().provider
    if (provider === 'disabled') throw new WebSearchError('web_search_not_configured')
    return provider
  }

  private requireApiKey(provider: WebSearchProviderName): string {
    const apiKey = this.getCredentialStore().getApiKey(webSearchCredentialId(provider))
    if (!apiKey) throw new WebSearchError('web_search_not_configured')
    return apiKey
  }

  private async withDeadline<T>(
    signal: AbortSignal | undefined,
    run: (deadline: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = new WebSearchError('web_search_timeout')
    const timer = setTimeout(() => controller.abort(timeout), this.timeoutMs)
    const onAbort = () => controller.abort(signal!.reason)
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason)
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      return await run(controller.signal)
    } catch (error) {
      if (isTimeout(controller, timeout)) throw timeout
      if (error instanceof WebSearchError) throw error
      if (controller.signal.aborted) throw error
      throw new WebSearchError('web_search_failed')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

function isTimeout(controller: AbortController, timeout: WebSearchError): boolean {
  return controller.signal.aborted && controller.signal.reason === timeout
}
