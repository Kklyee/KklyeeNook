import { registerPiMcpTool } from '@/main/agent/pi/adapters/piMcpToolAdapter'
import type { ToolRegistry } from '@/main/tools/toolRegistry'
import type {
  McpCallToolResult,
  McpServerConfig,
  McpServerState,
  McpTool,
} from '@/shared/mcp/mcpServer'
import { McpClientConnection } from './mcpClientConnection'

interface McpConnection {
  connect(): Promise<void>
  listTools(): Promise<McpTool[]>
  callTool(name: string, args: unknown): Promise<McpCallToolResult>
  close(): Promise<void>
}

type McpConnectionFactory = (
  config: McpServerConfig,
  onClose: (error?: Error) => void,
  onToolsChanged: (tools: McpTool[]) => void,
) => McpConnection

interface McpConnectionEntry {
  signature: string
  connection: McpConnection
  tools: McpTool[]
  disposeTools: Map<string, () => void>
}

export class McpServerManager {
  private readonly configs = new Map<string, McpServerConfig>()
  private readonly signatures = new Map<string, string>()
  private readonly states = new Map<string, McpServerState>()
  private readonly connections = new Map<string, McpConnectionEntry>()
  private readonly generations = new Map<string, number>()
  private readonly pending = new Set<Promise<McpServerState>>()
  private closed = false

  constructor(
    private readonly registry: ToolRegistry,
    private readonly onToolsChanged: () => void = () => undefined,
    private readonly createConnection: McpConnectionFactory = (config, onClose, onToolsChanged) =>
      new McpClientConnection(config, onClose, onToolsChanged),
  ) {}

  async reconcile(configs: readonly McpServerConfig[]): Promise<void> {
    if (this.closed) return
    const nextConfigs = new Map(configs.map((config) => [config.id, config]))
    for (const id of this.configs.keys()) {
      if (nextConfigs.has(id)) continue
      this.nextGeneration(id)
      this.configs.delete(id)
      this.signatures.delete(id)
      this.states.delete(id)
      await this.disconnectConnection(id)
    }

    for (const config of nextConfigs.values()) {
      const signature = configSignature(config)
      const previousSignature = this.signatures.get(config.id)
      this.configs.set(config.id, config)
      this.signatures.set(config.id, signature)
      if (!config.enabled) {
        this.nextGeneration(config.id)
        await this.disconnectConnection(config.id)
        this.setState({ serverId: config.id, status: 'disconnected', toolCount: 0 })
      } else if (previousSignature !== signature || !this.states.has(config.id)) {
        this.track(this.startConnection(config, signature))
      } else {
        this.syncTools(config.id)
      }
    }
  }

  listStates(): McpServerState[] {
    return [...this.configs.values()].map(
      (config) =>
        this.states.get(config.id) ?? {
          serverId: config.id,
          status: 'disconnected',
          toolCount: 0,
        },
    )
  }

  connect(serverId: string): Promise<McpServerState> {
    const config = this.getEnabledConfig(serverId)
    return this.track(this.startConnection(config, configSignature(config)))
  }

  disconnect(serverId: string): Promise<void> {
    return this.disconnectServer(serverId)
  }

  retry(serverId: string): Promise<McpServerState> {
    const config = this.getEnabledConfig(serverId)
    return this.track(this.startConnection(config, configSignature(config)))
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const id of this.configs.keys()) this.nextGeneration(id)
    await Promise.all([...this.connections.keys()].map((id) => this.disconnectConnection(id)))
    await Promise.all(this.pending)
    this.connections.clear()
    this.states.clear()
    this.configs.clear()
    this.signatures.clear()
  }

  private async startConnection(
    config: McpServerConfig,
    signature: string,
  ): Promise<McpServerState> {
    const current = this.states.get(config.id)
    const existing = this.connections.get(config.id)
    if (
      existing?.signature === signature &&
      (current?.status === 'connected' || current?.status === 'connecting')
    ) {
      return current
    }

    const generation = this.nextGeneration(config.id)
    await this.disconnectConnection(config.id)
    if (!this.isCurrent(config.id, generation)) return this.getState(config.id)
    this.setState({ serverId: config.id, status: 'connecting', toolCount: 0 })

    let connection: McpConnection | undefined
    try {
      connection = this.createConnection(
        config,
        (error) => {
          if (connection) void this.handleConnectionClosed(config.id, connection, error)
        },
        (tools) => {
          if (!connection || !this.isCurrentConnection(config.id, generation, connection)) return
          if (this.states.get(config.id)?.status !== 'connected') return
          const entry = this.connections.get(config.id)!
          for (const dispose of entry.disposeTools.values()) dispose()
          entry.disposeTools.clear()
          entry.tools = tools
          this.setState({ serverId: config.id, status: 'connected', toolCount: tools.length })
          this.syncTools(config.id)
        },
      )
    } catch (error) {
      return this.setConnectionError(config.id, generation, error)
    }

    const entry: McpConnectionEntry = { signature, connection, tools: [], disposeTools: new Map() }
    this.connections.set(config.id, entry)
    try {
      await connection.connect()
      if (!this.isCurrentConnection(config.id, generation, connection)) {
        await connection.close()
        return this.getState(config.id)
      }
      const tools = await connection.listTools()
      if (!this.isCurrentConnection(config.id, generation, connection)) {
        await connection.close()
        return this.getState(config.id)
      }
      entry.tools = tools
      this.setState({
        serverId: config.id,
        status: 'connected',
        toolCount: tools.length,
        tools: this.getToolStates(config.id, entry.tools),
      })
      this.syncTools(config.id)
      return this.getState(config.id)
    } catch (error) {
      if (!this.isCurrentConnection(config.id, generation, connection)) {
        await connection.close().catch(() => undefined)
        return this.getState(config.id)
      }
      await this.releaseConnection(config.id, connection)
      return this.setConnectionError(config.id, generation, error)
    }
  }

  private async disconnectServer(serverId: string): Promise<void> {
    this.nextGeneration(serverId)
    await this.disconnectConnection(serverId)
    if (!this.configs.has(serverId)) return
    this.setState({ serverId, status: 'disconnected', toolCount: 0, tools: [] })
  }

  private async disconnectConnection(serverId: string): Promise<void> {
    await this.releaseConnection(serverId)
  }

  private async releaseConnection(serverId: string, expected?: McpConnection): Promise<void> {
    const entry = this.connections.get(serverId)
    if (!entry || (expected && entry.connection !== expected)) return
    this.connections.delete(serverId)
    const hadTools = entry.disposeTools.size > 0
    for (const dispose of entry.disposeTools.values()) dispose()
    entry.disposeTools.clear()
    if (hadTools) this.onToolsChanged()
    await entry.connection.close().catch(() => undefined)
  }

  private async handleConnectionClosed(
    serverId: string,
    connection: McpConnection,
    error?: Error,
  ): Promise<void> {
    if (this.closed || this.connections.get(serverId)?.connection !== connection) return
    const generation = this.nextGeneration(serverId)
    await this.releaseConnection(serverId, connection)
    if (!this.isCurrent(serverId, generation)) return
    this.setState({
      serverId,
      status: 'error',
      toolCount: 0,
      error: error?.message ?? 'MCP server process exited.',
    })
  }

  private setConnectionError(
    serverId: string,
    generation: number,
    error: unknown,
  ): McpServerState {
    if (!this.isCurrent(serverId, generation)) return this.getState(serverId)
    const state: McpServerState = {
      serverId,
      status: 'error',
      toolCount: 0,
      error: error instanceof Error ? error.message : String(error),
    }
    this.setState(state)
    return state
  }

  private getEnabledConfig(serverId: string): McpServerConfig {
    const config = this.configs.get(serverId)
    if (!config) throw new Error(`Unknown MCP server: ${serverId}`)
    if (!config.enabled) throw new Error(`MCP server is disabled: ${serverId}`)
    return config
  }

  private getState(serverId: string): McpServerState {
    return (
      this.states.get(serverId) ?? {
        serverId,
        status: 'disconnected',
        toolCount: 0,
      }
    )
  }

  private setState(state: McpServerState): void {
    this.states.set(state.serverId, state)
  }

  private syncTools(serverId: string): void {
    const entry = this.connections.get(serverId)
    const config = this.configs.get(serverId)
    if (!entry || !config || this.states.get(serverId)?.status !== 'connected') return
    const disabledTools = new Set(config.disabledTools ?? [])
    const enabledTools = entry.tools.filter((tool) => !disabledTools.has(tool.name))
    const enabledNames = new Set(enabledTools.map((tool) => tool.name))
    let changed = false
    for (const [name, dispose] of entry.disposeTools) {
      if (enabledNames.has(name)) continue
      dispose()
      entry.disposeTools.delete(name)
      changed = true
    }
    for (const tool of enabledTools) {
      if (entry.disposeTools.has(tool.name)) continue
      entry.disposeTools.set(
        tool.name,
        registerPiMcpTool(this.registry, config, tool, entry.connection),
      )
      changed = true
    }
    this.setState({
      serverId,
      status: 'connected',
      toolCount: entry.tools.length,
      tools: this.getToolStates(serverId, entry.tools),
    })
    if (changed) this.onToolsChanged()
  }

  private getToolStates(serverId: string, tools: McpTool[]): NonNullable<McpServerState['tools']> {
    const disabledTools = new Set(this.configs.get(serverId)?.disabledTools ?? [])
    return tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      enabled: !disabledTools.has(tool.name),
    }))
  }

  private nextGeneration(serverId: string): number {
    const next = (this.generations.get(serverId) ?? 0) + 1
    this.generations.set(serverId, next)
    return next
  }

  private isCurrent(serverId: string, generation: number): boolean {
    return !this.closed && this.generations.get(serverId) === generation
  }

  private isCurrentConnection(
    serverId: string,
    generation: number,
    connection: McpConnection,
  ): boolean {
    return (
      this.isCurrent(serverId, generation) &&
      this.connections.get(serverId)?.connection === connection
    )
  }

  private track(task: Promise<McpServerState>): Promise<McpServerState> {
    this.pending.add(task)
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task),
    )
    return task
  }
}

function configSignature(config: McpServerConfig): string {
  const connectionConfig = { ...config }
  delete connectionConfig.disabledTools
  return JSON.stringify(connectionConfig)
}
