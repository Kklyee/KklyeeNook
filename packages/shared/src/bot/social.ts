export type Principal = { type: 'user'; id: string } | { type: 'bot'; id: string }

export type NetworkBotIdentity = {
  networkId: string
  localBotId: string
  ownerUserId: string
  hostId: string
  name: string
}

export const SOCIAL_ACTIONS = [
  'message.send',
  'task.request',
  'tool.propose',
  'tool.install',
  'tool.invoke',
] as const
export type SocialAction = (typeof SOCIAL_ACTIONS)[number]

export type SocialGrant = {
  id: string
  issuerUserId: string
  subject: Principal
  targetBotId: string
  actions: SocialAction[]
  constraints?: {
    allowedToolIds?: string[]
    allowedMcpServers?: string[]
    maxUses?: number
    expiresAt?: number
  }
  revokedAt?: number
}

export type NetworkOperation = {
  id: string
  subject: Principal
  targetBotId: string
  action: SocialAction
  grantId?: string
  state: 'pending' | 'awaiting_approval' | 'installing' | 'completed' | 'failed' | 'rejected'
  createdAt: number
  updatedAt: number
  error?: string
}
