import { SandboxService } from '@/main/sandbox/sandboxService'
import { createRemoteAgentPort } from '@/main/remote/remoteAgentPort'
import { RemoteController } from '@/main/remote/remoteController'
import { platformSandboxBackend } from '@/main/sandbox/sandboxBackend'
import { PERMISSION_MODES } from '@/shared/approval/permission'
import { ExecutionContextService } from '@/main/workspace/executionContextService'
import { AgentService } from '@/main/agent/agentService'
import { WorkspaceService } from '@/main/workspace/workspaceService'
import { DrizzleWorkspaceRepo } from '@/main/db/repositories/workspaceRepo'
import { PiClientService } from '@/main/agent/pi/client/piClientService'
import { MessageProjectionService } from '@/main/agent/messageProjectionService'
import { createPiAgentRuntimeFactory } from '@/main/agent/pi/runtime/createPiAgentRuntime'
import { PiSessionRuntime } from '@/main/agent/pi/runtime/piSessionRuntime'
import { PiSessionRuntimeManager } from '@/main/agent/pi/runtime/piSessionRuntimeManager'
import { registerPiBuiltinTools } from '@/main/agent/pi/adapters/piBuiltinToolAdapter'
import { registerPiMemoryTool } from '@/main/agent/pi/adapters/piMemoryToolAdapter'
import { registerPiPlanTool } from '@/main/agent/pi/adapters/piPlanToolAdapter'
import { registerPiDelegateTaskTool } from '@/main/agent/pi/adapters/piDelegateTaskToolAdapter'
import { ContextAttachmentService } from '@/main/context/contextAttachmentService'
import { ContextBuilder } from '@/main/context/contextBuilder'
import { connectDatabase } from '@/main/db/client'
import { DrizzleAgentExecutionRecordRepo } from '@/main/db/repositories/agentExecutionRecordRepo'
import { DrizzleAgentMessageRepo } from '@/main/db/repositories/agentMessageRepo'
import { DrizzleAgentMemoryRepo } from '@/main/db/repositories/memoryRepo'
import { DrizzleAgentRunRepo } from '@/main/db/repositories/agentRunRepo'
import { DrizzleAgentRuntimeStateRepo } from '@/main/db/repositories/agentRuntimeStateRepo'
import { DrizzleAgentSessionRepo } from '@/main/db/repositories/agentSessionRepo'
import { DrizzleScheduledTaskRepo } from '@/main/db/repositories/scheduledTaskRepo'
import { AgentConfigStore } from '@/main/settings/agentConfigStore'
import { MemoryCredentialStore } from '@/main/settings/credentialStore'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import { McpServerManager } from '@/main/mcp/mcpServerManager'
import type {
  AgentBackendInitOptions,
  AgentBackendRequest,
  AgentBackendStartupStage,
} from './protocol'
import { updateAgentModelSelectionFromCatalog } from '@/main/settings/modelCatalog'
import { startAgentHttpServer, type RunningAgentHttpServer } from './httpServer'
import { createPiNodeClientAdapter } from './piNodeClientAdapter'
import { SkillLoader } from './skillLoader'
import type { PiSubscribeRequest } from '@/shared/pi/piClient'
import type { PiClientEvent } from '@assistant-ui/react-pi'
import type { AgentBackendNotification } from '@/shared/agentBackend'
import { ScheduledTaskScheduler } from '@/main/scheduler/scheduledTaskScheduler'
import { join } from 'node:path'
import { createKnowledgeRuntime, type KnowledgeRuntime } from '@/main/knowledge/knowledgeRuntime'
import { DEFAULT_KNOWLEDGE_SETTINGS } from '@/shared/knowledge/knowledge'
import { registerPiKnowledgeTools } from '@/main/agent/pi/adapters/piKnowledgeToolAdapter'
import { registerPiWebSearchTool } from '@/main/agent/pi/adapters/piWebSearchToolAdapter'
import { WebSearchService } from '@/main/web-search/webSearchService'
import { DEFAULT_WEB_SEARCH_SETTINGS } from '@/shared/web-search/webSearch'
import { registerPiToolResultTool } from '@/main/agent/pi/adapters/piToolResultAdapter'
import { ToolResultStore } from '@/main/tools/toolResultStore'
import type { AgentEventEnvelope } from '@/shared/agent/agentExecutionRecord'

export interface AgentBackendRuntime {
  baseUrl: string
  handleRequest(request: AgentBackendRequest): Promise<unknown>
  subscribePi(request: PiSubscribeRequest, listener: (event: PiClientEvent) => void): () => void
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
  publishActivity: (envelope: AgentEventEnvelope) => void = () => undefined,
  publishModelSelection: (selection: import('@/shared/agent/agentSettings').UpdateAgentModelSelectionRequest) => void = () => undefined,
): Promise<AgentBackendRuntime> {
  const configStore = new AgentConfigStore(options.config)
  let credentialStore = createCredentialStore(options.apiKeys)
  const { database: db, close: closeDb } = await connectDatabase(
    options.databaseUrl,
    options.migrationsPath,
  )
  reportStartupStage('database_connected')

  let server: RunningAgentHttpServer | undefined
  let remote: RemoteController | undefined
  let scheduledTaskScheduler: ScheduledTaskScheduler | undefined
  let mcpServerManager: McpServerManager | undefined
  let knowledge: KnowledgeRuntime | undefined
  let settingsChangePending = false
  try {
    const workspaceService = new WorkspaceService(new DrizzleWorkspaceRepo(db))
    const memoryRepo = new DrizzleAgentMemoryRepo(db)
    const runtimeStateRepo = new DrizzleAgentRuntimeStateRepo(db)
    const sessionDir = options.sessionDir
    const sessionRepo = new DrizzleAgentSessionRepo(db)
    const executionContexts = new ExecutionContextService(sessionRepo, workspaceService, () => configStore.get().defaultPermissionMode ?? 'workspace-write')
    const skillLoader = new SkillLoader()
    await skillLoader.reload()
    const toolRegistry = new ToolRegistry()
    const sandbox = new SandboxService(platformSandboxBackend(join(sessionDir, '..')))
    const toolResultStore = new ToolResultStore(join(sessionDir, '..', 'tool-results'))
    registerPiBuiltinTools(toolRegistry, '')
    registerPiToolResultTool(toolRegistry, toolResultStore)
    registerPiMemoryTool(toolRegistry, memoryRepo)
    registerPiPlanTool(toolRegistry)
    knowledge = await createKnowledgeRuntime(db, options.databaseUrl, join(options.sessionDir, '..', 'knowledge-cache'), configStore.get().knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS, workspaceService)
    registerPiKnowledgeTools(toolRegistry, () => knowledge!.service)
    const webSearchService = new WebSearchService(
      () => configStore.get().webSearch ?? DEFAULT_WEB_SEARCH_SETTINGS,
      () => credentialStore,
    )
    registerPiWebSearchTool(toolRegistry, () => webSearchService)

    const sessionRuntimeManager = new PiSessionRuntimeManager(
      (sessionId, runtimeOptions) =>
        new PiSessionRuntime(
          sessionId,
          configStore,
          credentialStore,
          runtimeStateRepo,
          toolRegistry,
          sessionDir,
          skillLoader.directory,
          () => skillLoader.listSkills(),
          { ...runtimeOptions, sandbox, getExecutionContext: () => executionContexts.resolve(runtimeOptions?.permissionSessionId ?? sessionId) },
      ),
    )
    mcpServerManager = new McpServerManager(toolRegistry, () => {
      try {
        sessionRuntimeManager.reloadConfiguration()
      } catch {
        return
      }
    })
    await mcpServerManager.reconcile(configStore.get().mcpServers ?? [])
    const runtimeFactory = createPiAgentRuntimeFactory(sessionRuntimeManager)
    const runRepo = new DrizzleAgentRunRepo(db)
    const executionRecordRepo = new DrizzleAgentExecutionRecordRepo(db)
    const contextAttachments = new ContextAttachmentService()
    const contextBuilder = new ContextBuilder(contextAttachments, memoryRepo)
    const agentService = new AgentService(
      runtimeFactory,
      sessionRepo,
      runRepo,
      executionRecordRepo,
      {
        buildChildContext: async sessionId => contextBuilder.build([], (await executionContexts.resolve(sessionId)).workspaceId),
        onRunFinished: runId => sandbox.finishRun(runId),
      },
    )
    registerPiDelegateTaskTool(toolRegistry, (parentRunId, input, onProgress) =>
      agentService.delegateTask(parentRunId, input, onProgress),
    )

    await agentService.initialize((stage, count) => reportStartupStage(stage, String(count)))
    const unsubscribeActivity = agentService.subscribe(publishActivity)
    const messageProjection = new MessageProjectionService(new DrizzleAgentMessageRepo(db))
    const piClientService = new PiClientService(
      agentService,
      sessionRuntimeManager,
      messageProjection,
      configStore,
      contextBuilder,
      contextAttachments,
    )
    scheduledTaskScheduler = new ScheduledTaskScheduler(
      new DrizzleScheduledTaskRepo(db),
      agentService,
      {
        buildContext: async sessionId => contextBuilder.build([], (await executionContexts.resolve(sessionId)).workspaceId),
        projectSession: async (sessionId) => {
          await piClientService.getThread(sessionId)
        },
        notify,
      },
    )
    await scheduledTaskScheduler.start()
    const piClient = createPiNodeClientAdapter(piClientService, {

      agentDir: sessionDir,
    })
    remote = new RemoteController(
      createRemoteAgentPort(workspaceService, agentService, piClientService, sessionRuntimeManager, executionContexts, configStore, selection => {
        configStore.set(updateAgentModelSelectionFromCatalog(configStore.get(), { provider: selection.provider, modelID: selection.modelId, thinkingLevel: selection.thinkingLevel }))
        publishModelSelection(selection)
      }, contextAttachments),
      options.remoteStaticRoot ?? join(process.cwd(), 'apps/remote/dist'),
    )
    await remote.configure(configStore.get().remote ?? { enabled: false })
    server = await startAgentHttpServer(piClient, {
      allowedOrigins: options.allowedOrigins,
    })
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
          case 'conversation:compact': {
            const snapshot = await piClientService.getThread(request.id)
            if (snapshot.metadata.status === 'running') throw new Error('运行中无法整理上下文')
            await sessionRuntimeManager.getOrCreate(request.id).compact(request.instructions)
            return undefined
          }
          case 'tool-result:read':
            return (await toolResultStore.load(request.resultRef)).result
          case 'conversation:permission': {
            if (!PERMISSION_MODES.includes(request.mode)) throw new Error('权限模式无效')
            const context = await executionContexts.resolve(request.id)
            if (request.mode === 'workspace-write' && !context.workspace) throw new Error('需要关联一个可用项目')
            const updated = await agentService.setPermissionMode(request.id, request.mode)
            sessionRuntimeManager.get(request.id)?.reloadConfiguration()
            return updated
          }
          case 'conversation:list':
            return agentService.listSessions()
          case 'conversation:create':
            if (request.workspaceId) await workspaceService.resolve(request.workspaceId)
            return agentService.createSession(request.title, request.workspaceId)
          case 'workspace:list':
            return workspaceService.list()
          case 'workspace:attach': {
            sessionRuntimeManager.assertCanReloadConfiguration()
            const result = await workspaceService.attach(request.path, request)
            sessionRuntimeManager.reloadConfiguration()
            return result
          }
          case 'workspace:detach':
            sessionRuntimeManager.assertCanReloadConfiguration()
            await workspaceService.detach(request.id)
            sessionRuntimeManager.reloadConfiguration()
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
            sessionRuntimeManager.assertCanReloadConfiguration()
            knowledge!.service.assertCanReload()
            settingsChangePending = true
            return undefined
          case 'settings:commit':
            if (!settingsChangePending) throw new Error('No settings change is in progress')
            if (JSON.stringify(request.config.knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS) !== JSON.stringify(knowledge!.settings)) {
              await knowledge!.close()
              knowledge = await createKnowledgeRuntime(db, options.databaseUrl, join(options.sessionDir, '..', 'knowledge-cache'), request.config.knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS, workspaceService)
            }
            sessionRuntimeManager.reloadConfiguration()
            configStore.set(request.config)
            credentialStore = createCredentialStore(request.apiKeys)
            await mcpServerManager!.reconcile(request.config.mcpServers ?? [])
            settingsChangePending = false
            return undefined
          case 'settings:cancel':
            settingsChangePending = false
            return undefined
          case 'settings:model-selection':
            configStore.set(
              updateAgentModelSelectionFromCatalog(configStore.get(), {
                provider: request.selection.provider,
                modelID: request.selection.modelId,
                thinkingLevel: request.selection.thinkingLevel,
              }),
            )
            return undefined
          case 'mcp:list':
            return mcpServerManager!.listStates()
          case 'mcp:connect':
            return mcpServerManager!.connect(request.serverId)
          case 'mcp:disconnect':
            await mcpServerManager!.disconnect(request.serverId)
            return undefined
          case 'mcp:retry':
            return mcpServerManager!.retry(request.serverId)
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
          case 'skills:reload': {
            sessionRuntimeManager.assertCanReloadConfiguration()
            const skills = await skillLoader.reload()
            sessionRuntimeManager.reloadConfiguration()
            return skills
          }
          case 'agent-run:list':
            return agentService.listRuns(request.request.sessionId)
          case 'agent-run:overview-list':
            return agentService.listRunOverviews()
          case 'agent-execution-record:list':
            return agentService.listExecutionRecords(request.request.runId)
          case 'scheduled-task:list':
            return scheduledTaskScheduler!.list()
          case 'scheduled-task:create':
            return scheduledTaskScheduler!.create(request.input)
          case 'scheduled-task:update':
            return scheduledTaskScheduler!.update(request.id, request.input)
          case 'scheduled-task:delete':
            return scheduledTaskScheduler!.delete(request.id)
          case 'scheduled-task:enable':
            return scheduledTaskScheduler!.setEnabled(request.id, true)
          case 'scheduled-task:disable':
            return scheduledTaskScheduler!.setEnabled(request.id, false)
        }
      },
      subscribePi(request, listener) {
        return piClient.subscribe(request.threadId, listener, request.options)
      },
      async close() {
        await remote?.close()
        unsubscribeActivity()
        scheduledTaskScheduler?.stop()
        await knowledge?.close()
        await mcpServerManager?.close()
        await server?.close()
        contextAttachments.clear()
        piClientService.dispose()
        sessionRuntimeManager.dispose()
        closeDb()
      },
    }
  } catch (error) {
    await remote?.close()
    scheduledTaskScheduler?.stop()
    await knowledge?.close()
    await mcpServerManager?.close()
    await server?.close()
    closeDb()
    throw error
  }
}

function createCredentialStore(apiKeys: Record<string, string>): MemoryCredentialStore {
  const store = new MemoryCredentialStore()
  for (const [provider, apiKey] of Object.entries(apiKeys)) store.setApiKey(provider, apiKey)
  return store
}
