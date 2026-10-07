import type { Context } from 'hono'

export interface RemoteIdentityPolicy {
  allowedLogin?: string
  origin?: string
}

export function authorizeRemote(context: Context, policy: RemoteIdentityPolicy): 401 | 403 | undefined {
  const login = context.req.header('tailscale-user-login')
  if (!login) return 401
  if (!policy.allowedLogin || login !== policy.allowedLogin) return 403
  const origin = context.req.header('origin')
  if (!policy.origin || (origin && origin !== policy.origin)) return 403
  if (context.req.header('sec-fetch-site') === 'cross-site') return 403
  if (!['GET', 'HEAD'].includes(context.req.method) && origin !== policy.origin) return 403
  return undefined
}
