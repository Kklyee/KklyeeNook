import type { NetworkBotIdentity, SocialGrant, SocialRelationship } from './social'

export const GROVE_USER_CREDENTIAL = 'grove:user'
export const GROVE_HOST_CREDENTIAL = 'grove:host'

export type GroveSettings = { enabled: boolean; relayUrl: string; userId?: string; hostId?: string }
export type GroveStatus = GroveSettings & {
  hasUserCredential: boolean
  hasHostCredential: boolean
  credentialPersistenceAvailable: boolean
  error?: string
}
export type GroveConnectRequest = {
  enabled: boolean
  relayUrl: string
  userToken?: string
  hostName?: string
}
export type GroveConnections = {
  userId: string
  relationships: SocialRelationship[]
  bots: NetworkBotIdentity[]
  grants: Array<SocialGrant & { createdAt: number }>
}
