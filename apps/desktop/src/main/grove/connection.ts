import { hostname } from 'node:os'
import type { AgentConfigStore } from '@kklyeenook/agent/settings/agentConfigStore'
import type { CredentialStore } from '@kklyeenook/agent/settings/credentialStore'
import { GroveAccount } from '@kklyeenook/agent/grove/account'
import { RemoteTransport } from '@kklyeenook/agent/grove/remote-transport'
import {
  GROVE_HOST_CREDENTIAL,
  GROVE_USER_CREDENTIAL,
  type GroveConnectRequest,
  type GroveStatus,
} from '@kklyeenook/shared/bot/grove-settings'
import type { AgentBackendRequest } from '@kklyeenook/shared/agent/backend-protocol'
import {
  validateSharedMcp,
  type CapabilityOperation,
  type SharedMcp,
  type SharedToolsSnapshot,
} from '@kklyeenook/shared/bot/capabilities'

export class GroveConnection {
  private updating = false
  constructor(
    private readonly config: AgentConfigStore,
    private readonly credentials: CredentialStore,
    private readonly backend: { request(request: AgentBackendRequest): Promise<unknown> },
  ) {}

  async status(): Promise<GroveStatus> {
    const settings = this.config.get().grove ?? { enabled: false, relayUrl: '' }
    const network = (await this.backend
      .request({ action: 'grove:status' })
      .catch(() => ({ error: 'Local Agent Host is unavailable' }))) as { error?: string }
    return {
      ...settings,
      hasUserCredential: this.credentials.hasApiKey(GROVE_USER_CREDENTIAL),
      hasHostCredential: this.credentials.hasApiKey(GROVE_HOST_CREDENTIAL),
      credentialPersistenceAvailable: this.credentials.isPersistenceAvailable(),
      error: network.error,
    }
  }

  async configure(input: GroveConnectRequest): Promise<GroveStatus> {
    if (
      !input ||
      typeof input.enabled !== 'boolean' ||
      typeof input.relayUrl !== 'string' ||
      (input.userToken !== undefined && typeof input.userToken !== 'string') ||
      (input.hostName !== undefined && typeof input.hostName !== 'string')
    )
      throw new Error('Invalid Grove connection settings')
    if (this.updating) throw new Error('Grove connection settings are being updated')
    this.updating = true
    const previous = this.config.get()
    const oldUser = this.credentials.getApiKey(GROVE_USER_CREDENTIAL)
    const oldHost = this.credentials.getApiKey(GROVE_HOST_CREDENTIAL)
    try {
      if (input.enabled && !this.credentials.isPersistenceAvailable())
        throw new Error('Grove requires encrypted credential persistence')
      let settings = previous.grove ?? { enabled: false, relayUrl: '' }
      const url = input.relayUrl.trim()
      if (settings.relayUrl && url !== settings.relayUrl)
        throw new Error('Existing Grove identity is bound to its Relay URL')
      if (input.enabled) {
        const account = new GroveAccount(url, () => input.userToken?.trim() || oldUser)
        const identity = await account.me()
        if (settings.userId && settings.userId !== identity.userId)
          throw new Error('Existing Grove identity belongs to another User')
        let hostId = settings.hostId
        let hostToken = oldHost
        if (!hostId || !hostToken) {
          const host = await account.registerHost(input.hostName?.trim() || hostname())
          hostId = host.id
          hostToken = host.token
        } else {
          const device = await new RemoteTransport(url, () => hostToken).identity()
          if (device.id !== hostId || device.ownerUserId !== identity.userId)
            throw new Error('Saved Host credential does not match the configured identity')
        }
        settings = { enabled: true, relayUrl: url, userId: identity.userId, hostId }
        this.credentials.setApiKey(GROVE_USER_CREDENTIAL, input.userToken?.trim() || oldUser!)
        this.credentials.setApiKey(GROVE_HOST_CREDENTIAL, hostToken)
      } else settings = { ...settings, enabled: false }
      this.config.set({ ...this.config.get(), grove: settings })
      await this.backend.request({
        action: 'grove:configure',
        settings,
        hostToken: this.credentials.getApiKey(GROVE_HOST_CREDENTIAL),
      })
      return await this.status()
    } catch (error) {
      this.config.set({ ...this.config.get(), grove: previous.grove })
      if (oldUser) this.credentials.setApiKey(GROVE_USER_CREDENTIAL, oldUser)
      else this.credentials.deleteApiKey(GROVE_USER_CREDENTIAL)
      if (oldHost) this.credentials.setApiKey(GROVE_HOST_CREDENTIAL, oldHost)
      else this.credentials.deleteApiKey(GROVE_HOST_CREDENTIAL)
      await this.backend
        .request({
          action: 'grove:configure',
          settings: previous.grove ?? { enabled: false, relayUrl: '' },
          hostToken: oldHost,
        })
        .catch(() => undefined)
      throw error
    } finally {
      this.updating = false
    }
  }

  account() {
    const settings = this.config.get().grove
    if (!settings?.relayUrl) throw new Error('Grove Relay is not configured')
    return new GroveAccount(settings.relayUrl, () =>
      this.credentials.getApiKey(GROVE_USER_CREDENTIAL),
    )
  }
  async sharedTools(): Promise<SharedToolsSnapshot> {
    const remote = await this.account().sharedTools()
    return {
      ...remote,
      local: (await this.backend.request({
        action: 'grove:capabilities',
      })) as CapabilityOperation[],
    }
  }
  decideCapability(id: string, approved: boolean) {
    return this.backend.request({ action: 'grove:decide-capability', id, approved })
  }
  async configureMcp(input: { server: SharedMcp; credential?: string; shared?: boolean }) {
    validateSharedMcp(input.server)
    if (input.credential && !this.credentials.isPersistenceAvailable())
      throw new Error('MCP requires encrypted credential persistence')
    const current = this.config.get()
    if (this.updating) throw new Error('Grove settings are being updated')
    const existing = current.mcpServers?.find((server) => server.id === input.server.id)
    if (existing && (existing.transport !== 'http' || existing.url !== input.server.url))
      throw new Error('MCP ID is bound to another configuration')
    const server = {
      ...existing,
      ...input.server,
      transport: 'http' as const,
      command: '',
      args: [],
      shared: input.shared ?? true,
      enabled: existing?.enabled ?? false,
    }
    const servers = [...(current.mcpServers ?? []).filter((item) => item.id !== server.id), server]
    const credentialId = `mcp:${server.id}`
    const oldCredential = this.credentials.getApiKey(credentialId)
    this.updating = true
    try {
      if (input.credential) this.credentials.setApiKey(credentialId, input.credential)
      this.config.set({ ...current, mcpServers: servers })
      await this.backend.request({
        action: 'grove:catalog-configure',
        servers,
        credentialId: server.id,
        credential: input.credential,
      })
    } catch (error) {
      this.config.set({ ...this.config.get(), mcpServers: current.mcpServers })
      if (oldCredential) this.credentials.setApiKey(credentialId, oldCredential)
      else this.credentials.deleteApiKey(credentialId)
      await this.backend
        .request({
          action: 'grove:catalog-configure',
          servers: current.mcpServers ?? [],
          credentialId: server.id,
          credential: oldCredential,
        })
        .catch(() => undefined)
      throw error
    } finally {
      this.updating = false
    }
  }
}
