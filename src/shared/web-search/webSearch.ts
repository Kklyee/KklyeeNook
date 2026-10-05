export type WebSearchProviderId = 'disabled' | 'tavily' | 'exa'

export type WebSearchProviderName = Exclude<WebSearchProviderId, 'disabled'>

export const WEB_SEARCH_PROVIDER_NAMES: readonly WebSearchProviderName[] = ['tavily', 'exa']

export type WebSearchErrorCode =
  | 'web_search_not_configured'
  | 'web_search_invalid_api_key'
  | 'web_search_rate_limited'
  | 'web_search_quota_exceeded'
  | 'web_search_timeout'
  | 'web_search_failed'

export const WEB_SEARCH_ERROR_CODES: readonly WebSearchErrorCode[] = [
  'web_search_not_configured',
  'web_search_invalid_api_key',
  'web_search_rate_limited',
  'web_search_quota_exceeded',
  'web_search_timeout',
  'web_search_failed',
]

export interface WebSearchSettings {
  provider: WebSearchProviderId
}

export interface WebSearchRequest {
  query: string
  maxResults?: number
}

export interface WebSearchSource {
  title: string
  url: string
  snippet?: string
  publishedAt?: string
}

export interface WebSearchResult {
  query: string
  provider: WebSearchProviderName
  results: WebSearchSource[]
}

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = { provider: 'disabled' }

export const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProviderName, string> = {
  tavily: 'Tavily',
  exa: 'Exa',
}

export const WEB_SEARCH_ERROR_LABELS: Record<WebSearchErrorCode, string> = {
  web_search_not_configured: '未配置搜索提供商',
  web_search_invalid_api_key: 'API Key 无效',
  web_search_rate_limited: '请求过于频繁',
  web_search_quota_exceeded: '搜索额度已用尽',
  web_search_timeout: '请求超时',
  web_search_failed: '搜索失败',
}

export type WebSearchConnectionTestResult =
  | { ok: true }
  | { ok: false; code: WebSearchErrorCode }

export const DEFAULT_WEB_SEARCH_RESULTS = 5
export const MAX_WEB_SEARCH_RESULTS = 8
export const MAX_WEB_SEARCH_QUERY_CHARS = 1000
export const MAX_WEB_SEARCH_SNIPPET_CHARS = 1200
export const MAX_WEB_SEARCH_RESULT_CHARS = 8000
export const WEB_SEARCH_TIMEOUT_MS = 15_000

export function isWebSearchProviderName(value: unknown): value is WebSearchProviderName {
  return WEB_SEARCH_PROVIDER_NAMES.includes(value as WebSearchProviderName)
}

export function isWebSearchProviderId(value: unknown): value is WebSearchProviderId {
  return value === 'disabled' || isWebSearchProviderName(value)
}

export function isWebSearchErrorCode(value: unknown): value is WebSearchErrorCode {
  return WEB_SEARCH_ERROR_CODES.includes(value as WebSearchErrorCode)
}

export function webSearchCredentialId(provider: WebSearchProviderName): string {
  return `web-search:${provider}`
}

export function getWebSearchSettings(settings?: WebSearchSettings): WebSearchSettings {
  return isWebSearchProviderId(settings?.provider)
    ? { provider: settings!.provider }
    : DEFAULT_WEB_SEARCH_SETTINGS
}
