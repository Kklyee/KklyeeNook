import { EnvHttpProxyAgent } from 'undici'

const dispatcher =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.https_proxy ||
  process.env.http_proxy
    ? new EnvHttpProxyAgent()
    : undefined

export const knowledgeFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, ...(dispatcher ? { dispatcher } : {}) } as RequestInit)
