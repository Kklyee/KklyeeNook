import { validateSharedMcp, type SharedMcp } from '@kklyeenook/shared/bot/capabilities'
import type { AgentConfigStore } from '../settings/agentConfigStore'
import type { McpServerManager } from '../mcp/mcpServerManager'
import type { AgentHost } from '../runtime/agent-host'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { McpServerConfig } from '@kklyeenook/shared/mcp/mcpServer'

export interface CapabilityRuntime {
  catalog(): SharedMcp[]
  ready(server: SharedMcp): boolean
  install(botId: string, server: SharedMcp, revalidate: () => Promise<void>): Promise<void>
}

export function capabilityRuntime(
  config: AgentConfigStore,
  manager: McpServerManager,
  host: () => AgentHost,
  persist: (servers: McpServerConfig[]) => void = () => {},
  credential: (id: string) => string | undefined = () => undefined,
): CapabilityRuntime {
  return {
    ready: (server) => !server.requiresCredentials || Boolean(credential(server.id)),
    catalog: () =>
      (config.get().mcpServers ?? [])
        .filter((server) => server.transport === 'http' && server.shared)
        .map((server) => {
          const shared = {
            id: server.id,
            name: server.name,
            url: server.url!,
            requiresCredentials: server.requiresCredentials ?? false,
          }
          validateSharedMcp(shared)
          return shared
        }),
    async install(botId, server, revalidate) {
      validateSharedMcp(server)
      if (server.requiresCredentials && !credential(server.id))
        throw new Error('MCP requires credentials configured by its owner')
      const current = config.get()
      const existing = current.mcpServers?.find((item) => item.id === server.id)
      if (existing && (existing.transport !== 'http' || existing.url !== server.url))
        throw new Error('MCP ID is already bound to another configuration')
      const next = {
        ...existing,
        ...server,
        transport: 'http' as const,
        command: '',
        args: [],
        enabled: true,
      }
      await revalidate()
      config.set({
        ...current,
        mcpServers: [...(current.mcpServers ?? []).filter((item) => item.id !== server.id), next],
      })
      persist(config.get().mcpServers ?? [])
      await manager.reconcile(config.get().mcpServers ?? [])
      const state = await manager.connect(server.id)
      if (state.status !== 'connected') throw new Error('MCP connection or discovery failed')
      await revalidate()
      await host().refreshTools(BACKGROUND_CONTEXT)
      await host().bots!.withLock(botId, async () => {
        const bot = await host().bots!.get(botId)
        const names = (state.tools ?? [])
          .filter((tool) => tool.enabled)
          .map((tool) => `mcp__${server.id}__${tool.name}`)
        await host().bots!.update(botId, {
          enabledTools: [...new Set([...bot.enabledTools, ...names])],
        })
      })
    },
  }
}
