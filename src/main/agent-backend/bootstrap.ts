import { AgentService } from '@/main/agent/agentService'
import { PiClientService } from '@/main/agent/pi/client/piClientService'
import { MessageProjectionService } from '@/main/agent/messageProjectionService'
import { createPiAgentRuntimeFactory } from '@/main/agent/pi/runtime/createPiAgentRuntime'
import { PiSessionRuntime } from '@/main/agent/pi/runtime/piSessionRuntime'
import { PiSessionRuntimeManager } from '@/main/agent/pi/runtime/piSessionRuntimeManager'
import { registerPiArtifactTool } from '@/main/agent/pi/adapters/piArtifactToolAdapter'
import { registerPiBuiltinTools } from '@/main/agent/pi/adapters/piBuiltinToolAdapter'
import { registerPiMemoryTool } from '@/main/agent/pi/adapters/piMemoryToolAdapter'
import { registerPiPlanTool } from '@/main/agent/pi/adapters/piPlanToolAdapter'
import { registerPiDelegateTaskTool } from '@/main/agent/pi/adapters/piDelegateTaskToolAdapter'
import { ApprovalPolicy } from '@/main/approval/approvalPolicy'
import { ArtifactService } from '@/main/artifact/artifactService'
import { ContextAttachmentService } from '@/main/context/contextAttachmentService'
import { ContextBuilder } from '@/main/context/contextBuilder'
import { connectDatabase } from '@/main/db/client'
import { DrizzleAgentExecutionRecordRepo } from '@/main/db/repositories/agentExecutionRecordRepo'
import { DrizzleAgentMessageRepo } from '@/main/db/repositories/agentMessageRepo'
import { DrizzleAgentMemoryRepo } from '@/main/db/repositories/memoryRepo'
import { DrizzleAgentRunRepo } from '@/main/db/repositories/agentRunRepo'
import { DrizzleAgentRuntimeStateRepo } from '@/main/db/repositories/agentRuntimeStateRepo'
import { DrizzleAgentSessionRepo } from '@/main/db/repositories/agentSessionRepo'
import { DrizzleArtifactRepo } from '@/main/db/repositories/artifactRepo'
import { DrizzleScheduledTaskRepo } from '@/main/db/repositories/scheduledTaskRepo'
import { DrizzlePermissionGrantRepo } from '@/main/db/repositories/permissionGrantRepo'
import { AgentConfigStore } from '@/main/settings/agentConfigStore'
import { MemoryCredentialStore } from '@/main/settings/credentialStore'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import type {
  AgentBackendInitOptions,
  AgentBackendRequest,
  AgentBackendStartupStage,
} from './protocol'
import { startAgentHttpServer, type RunningAgentHttpServer } from './httpServer'
import { createPiNodeClientAdapter } from './piNodeClientAdapter'
import { SkillLoader } from './skillLoader'
import type { PiSubscribeRequest } from '@/shared/pi/piClient'
import type { PiClientEvent } from '@assistant-ui/react-pi'
import type { AgentBackendNotification } from '@/shared/agentBackend'
import { ScheduledTaskScheduler } from '@/main/scheduler/scheduledTaskScheduler'

export interface AgentBackendRuntime {
  baseUrl: string
  handleRequest(request: AgentBackendRequest): Promise<unknown>
  subscribePi(request: PiSubscribeRequest, listener: (event: PiClientEvent) => void): () => void
  close(): Promise<void>
}

type AgentBackendInitializationStage = Exclude<
  AgentBackendStartupStage,
  'process_spawned' | 'ready'
>

type StartupStageReporter = (stage: AgentBackendInitializationStage, detail?: string) => void

export async function createAgentBackend(
  options: AgentBackendInitOptions,
  reportStartupStage: StartupStageReporter = () => undefined,
  notify: (notification: AgentBackendNotification) => void = () => undefined,
): Promise<AgentBackendRuntime> {
  const configStore = new AgentConfigStore(options.config)
  let credentialStore = createCredentialStore(options.apiKeys)
  const { database: db, close: closeDb } = await connectDatabase(
    options.databaseUrl,
    options.migrationsPath,
  )
  reportStartupStage('database_connected')

  let server: RunningAgentHttpServer | undefined
  let scheduledTaskScheduler: ScheduledTaskScheduler | undefined
  let settingsChangePending = false
  try {
    const permissionGrantRepo = new DrizzlePermissionGrantRepo(db)
    const memoryRepo = new DrizzleAgentMemoryRepo(db)
    const approvalPolicy = new ApprovalPolicy(permissionGrantRepo)
    const runtimeStateRepo = new DrizzleAgentRuntimeStateRepo(db)
    const sessionDir = options.sessionDir
    const skillLoader = new SkillLoader()
    await skillLoader.reload()
    const toolRegistry = new ToolRegistry()
    const workspace = () => {
      const cwd = configStore.get().cwd
      if (!cwd) throw new Error('Agent workspace is not configured')
      return cwd
    }
    registerPiBuiltinTools(toolRegistry, workspace())
    registerPiArtifactTool(toolRegistry)
    registerPiMemoryTool(toolRegistry, memoryRepo, workspace())
    registerPiPlanTool(toolRegistry)

    const sessionRuntimeManager = new PiSessionRuntimeManager(
      (sessionId, runtimeOptions) =>
        new PiSessionRuntime(
          sessionId,
          configStore,
          credentialStore,
          approvalPolicy,
          runtimeStateRepo,
          toolRegistry,
          sessionDir,
          skillLoader.directory,
          () => skillLoader.listSkills(),
          runtimeOptions,
        ),
    )
    const runtimeFactory = createPiAgentRuntimeFactory(sessionRuntimeManager)
    const sessionRepo = new DrizzleAgentSessionRepo(db)
    const runRepo = new DrizzleAgentRunRepo(db)
    const executionRecordRepo = new DrizzleAgentExecutionRecordRepo(db)
    const artifactRepo = new DrizzleArtifactRepo(db)
    const contextAttachments = new ContextAttachmentService()
    const contextBuilder = new ContextBuilder(contextAttachments, memoryRepo)
    const agentService = new AgentService(
      runtimeFactory,
      sessionRepo,
      runRepo,
      executionRecordRepo,
      artifactRepo,
      { buildChildContext: () => contextBuilder.build([], workspace()) },
    )
    registerPiDelegateTaskTool(toolRegistry, (parentRunId, input, onProgress) =>
      agentService.delegateTask(parentRunId, input, onProgress),
    )
    const artifactService = new ArtifactService(artifactRepo, workspace)

    await agentService.initialize((stage, count) => reportStartupStage(stage, String(count)))
    const messageProjection = new MessageProjectionService(new DrizzleAgentMessageRepo(db))
    const piClientService = new PiClientService(
      agentService,
      sessionRuntimeManager,
      messageProjection,
      configStore,
      artifactService,
      contextBuilder,
      contextAttachments,
    )
    scheduledTaskScheduler = new ScheduledTaskScheduler(
      new DrizzleScheduledTaskRepo(db),
      agentService,
      {
        buildContext: () => contextBuilder.build([], workspace()),
        projectSession: async (sessionId) => {
          await piClientService.getThread(sessionId)
        },
        notify,
      },
    )
    await scheduledTaskScheduler.start()
    const piClient = createPiNodeClientAdapter(piClientService, {
      workspacePath: workspace(),
      agentDir: sessionDir,
    })
    server = await startAgentHttpServer(piClient, {
      allowedOrigins: options.allowedOrigins,
    })
    const endpoint = new URL(server.baseUrl)
    reportStartupStage('http_server_listening', `${endpoint.hostname}:${endpoint.port}`)

    return {
      baseUrl: server.baseUrl,
      async handleRequest(request) {
        switch (request.action) {
          case 'settings:prepare':
            if (settingsChangePending) throw new Error('A settings change is already in progress')
            sessionRuntimeManager.assertCanReloadConfiguration()
            settingsChangePending = true
            return undefined
          case 'settings:commit':
            if (!settingsChangePending) throw new Error('No settings change is in progress')
            sessionRuntimeManager.reloadConfiguration()
            configStore.set(request.config)
            credentialStore = createCredentialStore(request.apiKeys)
            settingsChangePending = false
            return undefined
          case 'settings:cancel':
            settingsChangePending = false
            return undefined
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
        scheduledTaskScheduler?.stop()
        await server?.close()
        contextAttachments.clear()
        piClientService.dispose()
        sessionRuntimeManager.dispose()
        closeDb()
      },
    }
  } catch (error) {
    scheduledTaskScheduler?.stop()
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
