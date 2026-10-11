import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { SandboxService } from '../sandbox/sandboxService'
import { createRemoteAgentPort } from '../remote/remoteAgentPort'
import { RemoteController } from '../remote/remoteController'
import { platformSandboxBackend } from '../sandbox/sandboxBackend'
import { PERMISSION_MODES } from '@kklyeenook/shared/approval/permission'
import { WorkspaceService } from '../workspace/workspaceService'
import { DrizzleWorkspaceRepo } from '../db/repositories/workspaceRepo'
import { ContextAttachmentService } from '../context/contextAttachmentService'
import { ContextBuilder } from '../context/contextBuilder'
import { connectDatabase } from '../db/client'
import { DrizzleAgentMemoryRepo } from '../db/repositories/memoryRepo'
import { DrizzleAgentSessionRepo } from '../db/repositories/agent-session-repo'
import { DrizzleScheduledTaskRepo } from '../db/repositories/scheduledTaskRepo'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { MemoryCredentialStore } from '../settings/credentialStore'
import { ToolRegistry } from '../tools/toolRegistry'
import { McpServerManager } from '../mcp/mcpServerManager'
import type {
  AgentBackendInitOptions,
  AgentBackendRequest,
  AgentBackendStartupStage,
} from '@kklyeenook/shared/agent/backend-protocol'
import { updateAgentModelSelectionFromCatalog } from '../settings/model-catalog'
import { startAgentHttpServer } from './agent-http'
import type { RunningAgentHttpServer } from './http-server'
import { AgentScheduler } from '../scheduler/agent-scheduler'
import { SkillLoader } from './skillLoader'
import type { AgentBackendNotification } from '@kklyeenook/shared/agentBackend'
import { createKnowledgeRuntime, type KnowledgeRuntime } from '../knowledge/knowledgeRuntime'
import { DEFAULT_KNOWLEDGE_SETTINGS } from '@kklyeenook/shared/knowledge/knowledge'
import { registerBuiltinTools } from '../tools/builtin-tools'
import { registerMemoryTool } from '../tools/memory-tool'
import { registerPlanTool } from '../tools/plan-tool'
import { registerKnowledgeTools } from '../tools/knowledge-tools'
import { registerWebSearchTool } from '../tools/web-search-tool'
import { WebSearchService } from '../web-search/webSearchService'
import { DEFAULT_WEB_SEARCH_SETTINGS } from '@kklyeenook/shared/web-search/webSearch'
import { registerToolResultTool } from '../tools/result-tool'
import { ToolResultStore } from '../tools/toolResultStore'
import { FileToolResultRetentionPolicy } from '../tools/toolResultRetentionPolicy'
import { RunProjection } from '../runtime/run-projection'
import { AgentHost } from '../runtime/agent-host'
import { AgentModels } from '../runtime/agent-models'
import { DrizzleBotRepo } from '../db/repositories/bot-repo'

export interface AgentBackendRuntime {
  baseUrl: string
  handleRequest(request: AgentBackendRequest): Promise<unknown>
  close(): Promise<void>
}

type AgentBackendInitializationStage = Exclude<
  AgentBackendStartupStage,
  'process_spawned' | 'entry_loaded' | 'modules_loaded' | 'ready'
>

type StartupStageReporter = (stage: AgentBackendInitializationStage, detail?: string) => void

export async function createAgentBackend(
  options: AgentBackendInitOptions,
  reportStartupStage: StartupStageReporter = () => undefined,
  notify: (notification: AgentBackendNotification) => void = () => undefined,
  publishModelSelection: (selection: import('@kklyeenook/shared/agent/agentSettings').UpdateAgentModelSelectionRequest) => void = () => undefined,
): Promise<AgentBackendRuntime> {
  const configStore = new AgentConfigStore(options.config)
  let credentialStore = createCredentialStore(options.apiKeys)
  const { database: db, close: closeDb } = await connectDatabase(
    options.databaseUrl,
    options.migrationsPath,
  )
  let server: RunningAgentHttpServer | undefined
  let remote: RemoteController | undefined
  let mcpServerManager: McpServerManager | undefined
  let knowledge: KnowledgeRuntime | undefined
  let host: AgentHost | undefined
  let scheduledTasks: AgentScheduler | undefined
  let settingsChangePending = false
  const contextAttachments = new ContextAttachmentService()
  const close = async () => {
    const results = await Promise.allSettled([remote?.close(), server?.close(), scheduledTasks?.close()])
    results.push(...await Promise.allSettled([host?.close()]))
    results.push(...await Promise.allSettled([knowledge?.close(), mcpServerManager?.close()]))
    contextAttachments.clear()
    closeDb()
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length) throw new AggregateError(failures, 'Agent backend cleanup failed')
  }
  try {
    reportStartupStage('database_connected')
    const workspaceService = new WorkspaceService(new DrizzleWorkspaceRepo(db))
    const memoryRepo = new DrizzleAgentMemoryRepo(db)
    const sessionRepo = new DrizzleAgentSessionRepo(db)
    scheduledTasks = new AgentScheduler(new DrizzleScheduledTaskRepo(db), notify)
    const dataDir = options.dataDir
    const skillLoader = new SkillLoader()
    await skillLoader.reload()
    const toolRegistry = new ToolRegistry()
    const sandbox = new SandboxService(platformSandboxBackend(dataDir))
    const toolResultStore = new ToolResultStore(join(dataDir, 'tool-results'))
    registerBuiltinTools(toolRegistry, '')
    registerToolResultTool(toolRegistry, toolResultStore)
    registerMemoryTool(toolRegistry, memoryRepo)
    registerPlanTool(toolRegistry)
    knowledge = await createKnowledgeRuntime(db, options.databaseUrl, join(options.dataDir, 'knowledge-cache'), configStore.get().knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS, workspaceService)
    registerKnowledgeTools(toolRegistry, () => knowledge!.service)
    const webSearchService = new WebSearchService(
      () => configStore.get().webSearch ?? DEFAULT_WEB_SEARCH_SETTINGS,
      () => credentialStore,
    )
    registerWebSearchTool(toolRegistry, () => webSearchService)
    const contextBuilder = new ContextBuilder(contextAttachments, memoryRepo)
    const retention = new FileToolResultRetentionPolicy(toolResultStore)
    mcpServerManager = new McpServerManager(toolRegistry, () => {
      void host?.refreshTools(BACKGROUND_CONTEXT).catch((error) => console.error('[agent-backend] MCP tool refresh failed', error))
    })
    await mcpServerManager.reconcile(configStore.get().mcpServers ?? [])
    host = await AgentHost.open({
      databasePath: join(dataDir, 'agent.sqlite'),
      config: () => configStore.get(),
      credentials: () => credentialStore,
      sessions: sessionRepo,
      botRepo: new DrizzleBotRepo(db),
      workspaces: workspaceService,
      tools: toolRegistry,
      sandbox,
      retention,
      contextBuilder,
      skills: skillLoader,
      onReport: (error) => console.error('[agent-backend] agent host report', error),
      extensions: [scheduledTasks.extension],
      initialize: async (initializing, context) => {
        scheduledTasks!.connect(initializing)
        await scheduledTasks!.restore(context)
      },
    }, BACKGROUND_CONTEXT)
    const runProjection = new RunProjection(host)
    remote = new RemoteController(
      createRemoteAgentPort(workspaceService, host, configStore, selection => {
        configStore.set(updateAgentModelSelectionFromCatalog(configStore.get(), { provider: selection.provider, modelID: selection.modelId, thinkingLevel: selection.thinkingLevel }))
        publishModelSelection(selection)
      }, contextAttachments),
      options.remoteStaticRoot ?? join(process.cwd(), 'apps/remote/dist'),
    )
    await remote.configure(configStore.get().remote ?? { enabled: false })
    server = await startAgentHttpServer(host, { allowedOrigins: options.allowedOrigins })
    const endpoint = new URL(server.baseUrl)
    reportStartupStage('http_server_listening', `${endpoint.hostname}:${endpoint.port}`)

    return {
      baseUrl: server.baseUrl,
      async handleRequest(request) {
        switch (request.action) {
          case 'remote:status':
            return remote!.status()
          case 'remote:configure': {
            const status = await remote!.configure(request.settings)
            configStore.set({ ...configStore.get(), remote: request.settings })
            return status
          }
          case 'conversation:compact':
            return (await host!.engine.conversation(request.id, BACKGROUND_CONTEXT)).compact(request.instructions, BACKGROUND_CONTEXT)
          case 'tool-result:read':
            return (await toolResultStore.load(request.resultRef)).result
          case 'conversation:permission': {
            if (!PERMISSION_MODES.includes(request.mode)) throw new Error('权限模式无效')
            return host!.conversations.update(request.id, { permissionMode: request.mode }, BACKGROUND_CONTEXT)
          }
          case 'conversation:list':
            return host!.conversations.list(BACKGROUND_CONTEXT)
          case 'conversation:create':
            if (request.workspaceId) await workspaceService.resolve(request.workspaceId)
            return host!.create({ threadId: randomUUID(), title: request.title, workspaceId: request.workspaceId }, BACKGROUND_CONTEXT)
          case 'workspace:list':
            return workspaceService.list()
          case 'workspace:attach':
            return workspaceService.attach(request.path, request)
          case 'workspace:detach':
            await workspaceService.detach(request.id)
            return undefined
          case 'knowledge:list':
            return knowledge!.service.listSources()
          case 'knowledge:add':
            return knowledge!.service.addSource(request.path, request.kind, request.workspaceId)
          case 'knowledge:reindex':
            return knowledge!.service.reindex(request.sourceId)
          case 'knowledge:remove':
            return knowledge!.service.removeSource(request.sourceId)
          case 'knowledge:search':
            return knowledge!.service.search(request.input)
          case 'knowledge:read':
            return knowledge!.service.read(request.chunkId)
          case 'settings:prepare':
            if (settingsChangePending) throw new Error('A settings change is already in progress')
            knowledge!.service.assertCanReload()
            settingsChangePending = true
            return undefined
          case 'settings:commit': {
            if (!settingsChangePending) throw new Error('No settings change is in progress')
            const previousConfig = configStore.get()
            const previousCredentials = credentialStore
            const nextCredentials = createCredentialStore(request.apiKeys)
            let knowledgeChanged = false
            try {
              new AgentModels(() => request.config, () => nextCredentials).selection()
              if (JSON.stringify(request.config.knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS) !== JSON.stringify(knowledge!.settings)) {
                knowledgeChanged = true
                await knowledge!.close()
                knowledge = undefined
                knowledge = await createKnowledgeRuntime(db, options.databaseUrl, join(options.dataDir, 'knowledge-cache'), request.config.knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS, workspaceService)
              }
              configStore.set(request.config)
              credentialStore = nextCredentials
              await mcpServerManager!.reconcile(request.config.mcpServers ?? [])
              await host!.reload(BACKGROUND_CONTEXT)
            } catch (error) {
              configStore.set(previousConfig)
              credentialStore = previousCredentials
              if (knowledgeChanged) {
                await knowledge?.close()
                knowledge = await createKnowledgeRuntime(db, options.databaseUrl, join(options.dataDir, 'knowledge-cache'), previousConfig.knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS, workspaceService)
              }
              await mcpServerManager!.reconcile(previousConfig.mcpServers ?? [])
              await host!.reload(BACKGROUND_CONTEXT)
              throw error
            } finally {
              settingsChangePending = false
            }
            return undefined
          }
          case 'settings:cancel':
            settingsChangePending = false
            return undefined
          case 'settings:model-selection':
            configStore.set(updateAgentModelSelectionFromCatalog(configStore.get(), {
              provider: request.selection.provider,
              modelID: request.selection.modelId,
              thinkingLevel: request.selection.thinkingLevel,
            }))
            await host!.reload(BACKGROUND_CONTEXT)
            return undefined
          case 'mcp:list':
            return mcpServerManager!.listStates()
          case 'mcp:connect': {
            const result = await mcpServerManager!.connect(request.serverId)
            await host!.refreshTools(BACKGROUND_CONTEXT)
            return result
          }
          case 'mcp:disconnect':
            await mcpServerManager!.disconnect(request.serverId)
            await host!.refreshTools(BACKGROUND_CONTEXT)
            return undefined
          case 'mcp:retry': {
            const result = await mcpServerManager!.retry(request.serverId)
            await host!.refreshTools(BACKGROUND_CONTEXT)
            return result
          }
          case 'context:stage':
            contextAttachments.storeResolved(request.attachment)
            return undefined
          case 'context:remove':
            contextAttachments.remove(request.id)
            return undefined
          case 'context:clear':
            contextAttachments.clear()
            return undefined
          case 'skills:list':
            return skillLoader.listSkills()
          case 'skills:get':
            return skillLoader.getSkill(request.id) ?? null
          case 'skills:reload':
            return skillLoader.reload()
          case 'agent-run:list': {
            return runProjection.list(request.request.sessionId, BACKGROUND_CONTEXT)
          }
          case 'agent-run:overview-list': {
            const threads = await host!.conversations.list(BACKGROUND_CONTEXT)
            return (await Promise.all(threads.map((thread) => runProjection.list(thread.id, BACKGROUND_CONTEXT)))).flat()
          }
          case 'agent-execution-record:list':
            return runProjection.records(request.request.runId, BACKGROUND_CONTEXT)
          case 'scheduled-task:list':
            return scheduledTasks!.list()
          case 'scheduled-task:create':
            return scheduledTasks!.create(request.input)
          case 'scheduled-task:update':
            return scheduledTasks!.update(request.id, request.input)
          case 'scheduled-task:delete':
            return scheduledTasks!.delete(request.id)
          case 'scheduled-task:enable':
            return scheduledTasks!.setEnabled(request.id, true)
          case 'scheduled-task:disable':
            return scheduledTasks!.setEnabled(request.id, false)
        }
      },
      close,
    }
  } catch (error) {
    try { await close() }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Agent backend initialization and cleanup failed') }
    throw error
  }
}


function createCredentialStore(apiKeys: Record<string, string>): MemoryCredentialStore {
  const store = new MemoryCredentialStore()
  for (const [provider, apiKey] of Object.entries(apiKeys)) store.setApiKey(provider, apiKey)
  return store
}
