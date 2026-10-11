import {
  SOCIAL_ACTIONS,
  type NetworkBotIdentity,
  type Principal,
  type SocialAction,
  type SocialGrant,
} from './social'

export type SocialRequest = {
  subject: Principal
  subjectOwnerUserId: string
  target: NetworkBotIdentity
  action: SocialAction
  toolId?: string
  mcpServerId?: string
}

export type SocialDecision =
  | { allowed: true; grantId?: string }
  | { allowed: false; reason: string }

export class SocialAuthorization {
  evaluate(
    request: SocialRequest,
    grants: readonly SocialGrant[],
    uses: Readonly<Record<string, number>>,
    now: number,
  ): SocialDecision {
    if (
      request.subjectOwnerUserId === request.target.ownerUserId &&
      (request.action === 'message.send' || request.action === 'task.request')
    )
      return { allowed: true }
    for (const grant of grants) {
      if (
        grant.issuerUserId !== request.target.ownerUserId ||
        grant.targetBotId !== request.target.networkId
      )
        continue
      if (grant.subject.type !== request.subject.type || grant.subject.id !== request.subject.id)
        continue
      if (!grant.actions.includes(request.action) || grant.revokedAt !== undefined) continue
      const constraints = grant.constraints
      if (constraints?.expiresAt !== undefined && constraints.expiresAt <= now) continue
      if (constraints?.maxUses !== undefined && (uses[grant.id] ?? 0) >= constraints.maxUses)
        continue
      if (
        constraints?.allowedToolIds !== undefined &&
        (!request.toolId || !constraints.allowedToolIds.includes(request.toolId))
      )
        continue
      if (
        constraints?.allowedMcpServers !== undefined &&
        (!request.mcpServerId || !constraints.allowedMcpServers.includes(request.mcpServerId))
      )
        continue
      return { allowed: true, grantId: grant.id }
    }
    return { allowed: false, reason: 'No effective Social Grant permits this operation' }
  }

  validateGrant(issuer: Principal, target: NetworkBotIdentity, grant: SocialGrant) {
    if (
      issuer.type !== 'user' ||
      issuer.id !== target.ownerUserId ||
      grant.issuerUserId !== issuer.id
    )
      throw new Error('Only the target Bot owner can issue Social Grants')
    if (grant.targetBotId !== target.networkId)
      throw new Error('Grant target does not match Bot identity')
    if (
      !grant.id.trim() ||
      !grant.subject.id.trim() ||
      !['user', 'bot'].includes(grant.subject.type) ||
      !grant.actions.length ||
      new Set(grant.actions).size !== grant.actions.length ||
      grant.actions.some((action) => !SOCIAL_ACTIONS.includes(action))
    )
      throw new Error('Invalid Social Grant')
    const constraints = grant.constraints
    if (
      constraints?.maxUses !== undefined &&
      (!Number.isSafeInteger(constraints.maxUses) || constraints.maxUses < 1)
    )
      throw new Error('maxUses must be a positive integer')
    if (
      constraints?.expiresAt !== undefined &&
      (!Number.isSafeInteger(constraints.expiresAt) || constraints.expiresAt < 1)
    )
      throw new Error('expiresAt must be a positive timestamp')
    if (
      constraints?.allowedToolIds?.some((id) => !id.trim()) ||
      constraints?.allowedMcpServers?.some((id) => !id.trim())
    )
      throw new Error('Invalid grant capability constraint')
  }
}
