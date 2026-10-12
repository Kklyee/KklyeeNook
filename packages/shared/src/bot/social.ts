export type Principal = { type: 'user'; id: string } | { type: 'bot'; id: string }

export type NetworkBotIdentity = {
  networkId: string
  localBotId: string
  ownerUserId: string
  hostId: string
  name: string
  role?: string
  avatar?: import('./bot').BotAvatarConfig
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

export type NetworkTaskRequest = {
  taskId: string
  chainId: string
  depth: number
  deadline: number
}

export type TaskOutcome = { status: 'completed' | 'failed' | 'rejected'; result: string }

export type RelayEnvelope = {
  message: import('./grove').BotMessage
  operation: NetworkOperation
  sender: NetworkBotIdentity
  target: NetworkBotIdentity
  sourceHostId: string
  task?: NetworkTaskRequest
  outcome?: TaskOutcome
}

export type SocialRelationship = {
  id: string
  requesterUserId: string
  recipientUserId: string
  state: 'pending' | 'accepted' | 'rejected' | 'revoked'
  createdAt: number
  updatedAt: number
}
