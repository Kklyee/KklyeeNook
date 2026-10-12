import { RemoteTransport } from './remote-transport'
import type { GroveConnections } from '@kklyeenook/shared/bot/grove-settings'
import type { SocialGrant, SocialRelationship } from '@kklyeenook/shared/bot/social'

export class GroveAccount extends RemoteTransport {
  me() {
    return this.request<{ userId: string }>('/me')
  }
  registerHost(name: string) {
    return this.request<{ id: string; ownerUserId: string; token: string }>('/hosts', { name })
  }
  connections() {
    return this.request<GroveConnections>('/connections')
  }
  invite(recipientUserId: string) {
    return this.request<SocialRelationship>('/relationships', { recipientUserId })
  }
  decide(id: string, state: 'accepted' | 'rejected' | 'revoked') {
    return this.request<SocialRelationship>(`/relationships/${encodeURIComponent(id)}/decision`, {
      state,
    })
  }
  grant(input: Omit<SocialGrant, 'id' | 'issuerUserId' | 'revokedAt'>) {
    return this.request<SocialGrant>('/grants', input)
  }
  revoke(id: string) {
    return this.request<void>(`/grants/${encodeURIComponent(id)}`, undefined, undefined, 'DELETE')
  }
}
