import type { WebSearchErrorCode } from '@/shared/web-search/webSearch'

const WEB_SEARCH_ERROR_MESSAGES: Record<WebSearchErrorCode, string> = {
  web_search_not_configured:
    'Web search is not configured. Tell the user to enable a web search provider in Settings instead of retrying.',
  web_search_invalid_api_key:
    'Web search failed with web_search_invalid_api_key: the configured API key was rejected. Tell the user to verify it in Settings.',
  web_search_rate_limited:
    'Web search failed with web_search_rate_limited: the provider is throttling requests. Wait before searching again or ask the user to check their plan.',
  web_search_quota_exceeded:
    'Web search failed with web_search_quota_exceeded: the provider reported no remaining search credits. Ask the user to check their billing.',
  web_search_timeout:
    'Web search failed with web_search_timeout: the provider did not answer in time and the request was aborted.',
  web_search_failed:
    'Web search failed with web_search_failed: the provider request did not succeed. Try again later or answer without web results.',
}

export class WebSearchError extends Error {
  constructor(
    readonly code: WebSearchErrorCode,
    message?: string,
  ) {
    super(message ?? WEB_SEARCH_ERROR_MESSAGES[code])
    this.name = 'WebSearchError'
  }
}

const INVALID_KEY_PATTERN =
  /invalid[_ -]?api[_ -]?key|unauthorized|api[_ -]?key[^.]*invalid|authentication|invalid[_ -]?token|forbidden/i
const QUOTA_PATTERN =
  /quota|credit|insufficient|balance|exhaust|payment required|billing|usage limit|out of credits/i
const RATE_LIMIT_PATTERN = /rate limit|too many requests|throttl|slow down/i

export function webSearchErrorFromStatus(status: number, detail?: string): WebSearchError {  const text = detail ?? ''
  if (status === 401 || status === 403 || INVALID_KEY_PATTERN.test(text)) {
    return new WebSearchError('web_search_invalid_api_key')
  }
  if (status === 402 || QUOTA_PATTERN.test(text)) {
    return new WebSearchError('web_search_quota_exceeded')
  }
  if (status === 429 || RATE_LIMIT_PATTERN.test(text)) {
    return new WebSearchError('web_search_rate_limited')
  }
  return new WebSearchError('web_search_failed')
}

export function webSearchErrorCode(value: unknown): WebSearchErrorCode {
  return value instanceof WebSearchError ? value.code : 'web_search_failed'
}
