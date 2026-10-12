import type { NetworkOperation } from './social'

export type SharedMcp = { id: string; name: string; url: string; requiresCredentials: boolean }

export type CapabilityRequest = {
  operationId: string
  targetBotId: string
  action: 'tool.propose' | 'tool.install'
  server: SharedMcp
}

export type CapabilityOperation = { operation: NetworkOperation; server: SharedMcp }
export type SharedToolsSnapshot = {
  catalog: Array<{ botId: string; servers: SharedMcp[] }>
  operations: CapabilityOperation[]
  local: CapabilityOperation[]
}

export function validateSharedMcp(server: SharedMcp) {
  const url = new URL(server.url)
  if (
    !server.id.trim() ||
    !server.name.trim() ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Shared MCP requires an HTTPS endpoint without credentials or query parameters')
  return url.href
}
