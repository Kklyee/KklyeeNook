import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { AgentConfig } from '@kklyeenook/shared/agent/agentConfig'
import { connectDatabase } from '../../../agent/src/db/client'
import { DrizzleAgentSessionRepo } from '../../../agent/src/db/repositories/agent-session-repo'
import { DrizzleBotRepo } from '../../../agent/src/db/repositories/bot-repo'
import { DrizzleGroveRepo } from '../../../agent/src/db/repositories/grove-repo'
import { DrizzleWorkspaceRepo } from '../../../agent/src/db/repositories/workspaceRepo'
import { DrizzleAgentMemoryRepo } from '../../../agent/src/db/repositories/memoryRepo'
import { WorkspaceService } from '../../../agent/src/workspace/workspaceService'
import { SandboxService } from '../../../agent/src/sandbox/sandbox-service'
import { ToolRegistry } from '../../../agent/src/tools/toolRegistry'
import { registerBuiltinTools } from '../../../agent/src/tools/builtin-tools'
import { MemoryCredentialStore } from '../../../agent/src/settings/credentialStore'
import { ContextAttachmentService } from '../../../agent/src/context/contextAttachmentService'
import { ContextBuilder } from '../../../agent/src/context/contextBuilder'
import { SkillLoader } from '../../../agent/src/backend/skillLoader'
import { AgentHost } from '../../../agent/src/runtime/agent-host'
import { RemoteTransport } from '../../../agent/src/grove/remote-transport'
import { AgentConfigStore } from '../../../agent/src/settings/agentConfigStore'
import { McpServerManager } from '../../../agent/src/mcp/mcpServerManager'
import { capabilityRuntime } from '../../../agent/src/grove/capability-runtime'
import type { SharedMcp } from '@kklyeenook/shared/bot/capabilities'

export async function testHost(
  relayUrl: string,
  token: string,
  name: string,
  answer: string,
  settings: { directory?: string; cleanup?: boolean } = {},
) {
  const directory = settings.directory ?? (await mkdtemp(join(tmpdir(), 'grove-host-')))
  await mkdir(join(directory, 'skills'), { recursive: true })
  const requests: Record<string, any>[] = []
  const model = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', model: name, choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }] })}\n\n`,
    )
    response.write(
      `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', model: name, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    )
    response.end('data: [DONE]\n\n')
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  const address = model.address()
  if (!address || typeof address === 'string') throw new Error('Model server not bound')
  const db = await connectDatabase(
    `file:${join(directory, 'host.sqlite')}`,
    fileURLToPath(new URL('../../../agent/drizzle', import.meta.url)),
  )
  const credentials = new MemoryCredentialStore()
  credentials.setApiKey('custom', 'test-model-credential')
  const config: AgentConfig = {
    model: {
      provider: 'custom',
      modelID: name,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: 'openai-completions',
    },
    tools: { enabled: [] },
    compaction: { enabled: false, reserveTokens: 1000, keepRecentTokens: 1000 },
  }
  const tools = new ToolRegistry()
  registerBuiltinTools(tools, '')
  const configStore = new AgentConfigStore(config, join(directory, 'config.json'))
  const mcp = new McpServerManager(tools, () => undefined, () => ({
    connect: async () => {}, listTools: async () => [{ name: 'inspect', inputSchema: { type: 'object' } }],
    callTool: async () => ({ content: [{ type: 'text', text: 'Shared design result' }] }), close: async () => {},
  }))
  await mcp.reconcile(configStore.get().mcpServers ?? [])
  const sessions = new DrizzleAgentSessionRepo(db.database)
  const memories = new DrizzleAgentMemoryRepo(db.database)
  const repo = new DrizzleGroveRepo(db.database)
  let current: AgentHost
  const options = {
    databasePath: join(directory, 'durable.sqlite'),
    config: () => configStore.get(),
    credentials: () => credentials,
    sessions,
    botRepo: new DrizzleBotRepo(db.database),
    groveRepo: repo,
    groveTransport: new RemoteTransport(relayUrl, () => token),
    groveCapabilities: capabilityRuntime(configStore, mcp, () => current),
    workspaces: new WorkspaceService(new DrizzleWorkspaceRepo(db.database)),
    tools,
    sandbox: new SandboxService({
      support: () => 'partial',
      execute: async () => {
        throw new Error('Sandbox not called')
      },
    }),
    retention: { process: async (_run: string, _call: unknown, result: any) => result },
    contextBuilder: new ContextBuilder(new ContextAttachmentService(), memories),
    skills: new SkillLoader(join(directory, 'skills')),
  }
  current = await AgentHost.open(options, BACKGROUND_CONTEXT)
  return {
    get host() {
      return current
    },
    repo,
    sessions,
    memories,
    requests,
    directory,
    async catalog(server: SharedMcp) {
      configStore.set({ ...configStore.get(), mcpServers: [{ ...server, transport: 'http', command: '', args: [], enabled: false, shared: true }] })
      await mcp.reconcile(configStore.get().mcpServers ?? [])
      await current.grove!.syncNetwork(BACKGROUND_CONTEXT)
    },
    installed: () => configStore.get().mcpServers ?? [],
    async restart() {
      await current.close()
      current = await AgentHost.open(options, BACKGROUND_CONTEXT)
      return current
    },
    async stop() {
      await current.close()
    },
    async resume() {
      current = await AgentHost.open(options, BACKGROUND_CONTEXT)
      return current
    },
    async close() {
      await current.close()
      await mcp.close()
      db.close()
      model.closeAllConnections()
      await new Promise<void>((resolve) => model.close(() => resolve()))
      if (settings.cleanup === false) return
      const resolved = join(directory)
      if (!resolved.startsWith(join(tmpdir(), 'grove-host-')))
        throw new Error('Unexpected test directory')
      await rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    },
  }
}
