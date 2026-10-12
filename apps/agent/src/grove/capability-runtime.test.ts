import { expect, test, vi } from 'vitest'
import { capabilityRuntime } from './capability-runtime'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { McpServerManager } from '../mcp/mcpServerManager'
import { ToolRegistry } from '../tools/toolRegistry'
import type { AgentHost } from '../runtime/agent-host'

test('MCP install rechecks authorization after discovery before enabling Bot tools', async () => {
  const config = new AgentConfigStore()
  const registry = new ToolRegistry()
  const manager = new McpServerManager(registry, undefined, () => ({
    connect: async () => {},
    listTools: async () => [{ name: 'inspect', inputSchema: { type: 'object' } }],
    callTool: async () => ({ content: [{ type: 'text', text: 'result' }] }),
    close: async () => {},
  }))
  const update = vi.fn()
  const host = {
    refreshTools: vi.fn(),
    bots: {
      withLock: async (_id: string, action: () => Promise<void>) => action(),
      get: async () => ({ enabledTools: [] }),
      update,
    },
  } as unknown as AgentHost
  const persist = vi.fn()
  const runtime = capabilityRuntime(config, manager, () => host, persist)
  const server = {
    id: 'design',
    name: 'Design',
    url: 'https://mcp.example.com/design',
    requiresCredentials: false,
  }
  const authorize = vi.fn(async () => {})
  authorize.mockRejectedValueOnce(new Error('revoked before install'))
  try {
    await expect(runtime.install('designer', server, authorize)).rejects.toThrow('revoked')
    expect(config.get().mcpServers).toBeUndefined()
    const afterDiscovery = vi
      .fn(async () => {})
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('revoked during discovery'))
    await expect(runtime.install('designer', server, afterDiscovery)).rejects.toThrow(
      'revoked during discovery',
    )
    expect(update).not.toHaveBeenCalled()
    await runtime.install('designer', server, async () => {})
    await runtime.install('designer', server, async () => {})
    expect(config.get().mcpServers).toHaveLength(1)
    expect(update).toHaveBeenCalledWith('designer', { enabledTools: ['mcp__design__inspect'] })
    expect(persist).toHaveBeenCalled()
  } finally {
    await manager.close()
  }
})
