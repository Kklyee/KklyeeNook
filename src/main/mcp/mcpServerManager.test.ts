import { expect, test, vi } from 'vitest'

import { ToolRegistry } from '@/main/tools/toolRegistry'
import type { McpServerConfig, McpTool } from '@/shared/mcp/mcpServer'
import { McpServerManager } from './mcpServerManager'

const tool: McpTool = {
  name: 'search',
  description: 'Search remotely',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
}

function config(id: string, enabled = true): McpServerConfig {
  return {
    id,
    name: id,
    enabled,
    transport: 'stdio',
    command: 'server',
    args: [],
  }
}

test('registers same-named tools with server identity and disposes them on disconnect', async () => {
  const registry = new ToolRegistry()
  const onToolsChanged = vi.fn()
  const connections: Array<{ closed: boolean; serverId: string }> = []
  const manager = new McpServerManager(registry, onToolsChanged, (server) => {
    const record = { closed: false, serverId: server.id }
    connections.push(record)
    return {
      async connect() {},
      async listTools() {
        return [tool]
      },
      async callTool(name: string) {
        return { content: [{ type: 'text' as const, text: `${server.id}:${name}` }] }
      },
      async close() {
        record.closed = true
      },
    }
  })

  await manager.reconcile([config('filesystem'), config('github')])
  await vi.waitFor(() =>
    expect(manager.listStates().map((state) => state.status)).toEqual(['connected', 'connected']),
  )

  expect(registry.get('mcp__filesystem__search')?.origin).toEqual({
    kind: 'mcp',
    serverId: 'filesystem',
    serverName: 'filesystem',
    remoteName: 'search',
  })
  expect(registry.get('mcp__github__search')).toBeDefined()
  const [toolInstance] = registry.resolve<{
    name: string
    execute(id: string, args: unknown): Promise<{ content: Array<{ text?: string }> }>
  }>('pi', ['mcp__filesystem__search'], { cwd: '/repo' })
  await expect(toolInstance.execute('call-1', { query: 'readme' })).resolves.toMatchObject({
    content: [{ text: 'filesystem:search' }],
  })

  await manager.disconnect('filesystem')
  expect(registry.get('mcp__filesystem__search')).toBeUndefined()
  expect(registry.get('mcp__github__search')).toBeDefined()
  expect(manager.listStates()[0]).toMatchObject({ status: 'disconnected', toolCount: 0 })
  expect(connections.find((connection) => connection.serverId === 'filesystem')?.closed).toBe(true)

  await manager.close()
  expect(registry.get('mcp__github__search')).toBeUndefined()
})

test('records a failed server without affecting other connections', async () => {
  const registry = new ToolRegistry()
  const manager = new McpServerManager(registry, () => undefined, (server) => ({
    async connect() {
      if (server.id === 'github') throw new Error('Process exited')
    },
    async listTools() {
      return [tool]
    },
    async callTool() {
      return { content: [] }
    },
    async close() {},
  }))

  await manager.reconcile([config('filesystem'), config('github')])
  await vi.waitFor(() =>
    expect(manager.listStates().map((state) => state.status)).toEqual(['connected', 'error']),
  )

  expect(manager.listStates()[1]).toMatchObject({
    error: 'Process exited',
    toolCount: 0,
  })
  expect(registry.get('mcp__filesystem__search')).toBeDefined()
  expect(registry.get('mcp__github__search')).toBeUndefined()

  await manager.close()
})

test('does not reconnect a failed server during an unrelated reconcile', async () => {
  const registry = new ToolRegistry()
  const connect = vi.fn(async () => {
    throw new Error('Process exited')
  })
  const manager = new McpServerManager(registry, () => undefined, () => ({
    connect,
    async listTools() {
      return []
    },
    async callTool() {
      return { content: [] }
    },
    async close() {},
  }))

  await manager.reconcile([config('github')])
  await vi.waitFor(() => expect(manager.listStates()[0]?.status).toBe('error'))
  await manager.reconcile([config('github')])

  expect(connect).toHaveBeenCalledTimes(1)
  await manager.close()
})
