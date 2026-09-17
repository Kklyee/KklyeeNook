import { AgentService } from '@/main/agent/agentService'
import { PiClientService } from '@/main/agent/pi/client/piClientService'
import { MessageProjectionService } from '@/main/agent/messageProjectionService'
import { createPiAgentRuntimeFactory } from '@/main/agent/pi/runtime/createPiAgentRuntime'
import { PiSessionRuntime } from '@/main/agent/pi/runtime/piSessionRuntime'
import { PiSessionRuntimeManager } from '@/main/agent/pi/runtime/piSessionRuntimeManager'
import { registerPiArtifactTool } from '@/main/agent/pi/adapters/piArtifactToolAdapter'
import { registerPiBuiltinTools } from '@/main/agent/pi/adapters/piBuiltinToolAdapter'
import { ApprovalPolicy } from '@/main/approval/approvalPolicy'
import { ArtifactService } from '@/main/artifact/artifactService'
import { ContextAttachmentService } from '@/main/context/contextAttachmentService'
import { ContextBuilder } from '@/main/context/contextBuilder'
import { connectDatabase } from '@/main/db/client'
import { DrizzleAgentExecutionRecordRepo } from '@/main/db/repositories/agentExecutionRecordRepo'
import { DrizzleAgentMessageRepo } from '@/main/db/repositories/agentMessageRepo'
import { DrizzleAgentRunRepo } from '@/main/db/repositories/agentRunRepo'
import { DrizzleAgentRuntimeStateRepo } from '@/main/db/repositories/agentRuntimeStateRepo'
import { DrizzleAgentSessionRepo } from '@/main/db/repositories/agentSessionRepo'
import { DrizzleArtifactRepo } from '@/main/db/repositories/artifactRepo'
import { DrizzlePermissionGrantRepo } from '@/main/db/repositories/permissionGrantRepo'
import { AgentConfigStore } from '@/main/settings/agentConfigStore'
import { MemoryCredentialStore } from '@/main/settings/credentialStore'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import type { AgentBackendInitOptions, AgentBackendRequest } from './protocol'
import { startAgentHttpServer, type RunningAgentHttpServer } from './httpServer'
import { createPiNodeClientAdapter } from './piNodeClientAdapter'
import type { ContextAwarePiClient } from '@/shared/pi/piClient'
import type { PiClientCall, PiSubscribeRequest } from '@/shared/pi/piIpc'
import type { PiClientEvent } from '@assistant-ui/react-pi'

export interface AgentBackendRuntime {
  baseUrl: string
  handleRequest(request: AgentBackendRequest): Promise<unknown>
  subscribePi(request: PiSubscribeRequest, listener: (event: PiClientEvent) => void): () => void
  close(): Promise<void>
}

export async function createAgentBackend(
  options: AgentBackendInitOptions,
): Promise<AgentBackendRuntime> {
  const configStore = new AgentConfigStore(options.config)
  let credentialStore = createCredentialStore(options.apiKeys)
  const { database: db, close: closeDb } = await connectDatabase(
    options.databaseUrl,
    options.migrationsPath,
  )

  let server: RunningAgentHttpServer | undefined
  let settingsChangePending = false
  try {
    const permissionGrantRepo = new DrizzlePermissionGrantRepo(db)
    const approvalPolicy = new ApprovalPolicy(permissionGrantRepo)
    const runtimeStateRepo = new DrizzleAgentRuntimeStateRepo(db)
    const sessionDir = options.sessionDir
    const toolRegistry = new ToolRegistry()
    const workspace = () => {
      const cwd = configStore.get().cwd
      if (!cwd) throw new Error('Agent workspace is not configured')
      return cwd
    }
    registerPiBuiltinTools(toolRegistry, workspace())
    registerPiArtifactTool(toolRegistry)

    const sessionRuntimeManager = new PiSessionRuntimeManager(
      (sessionId) =>
        new PiSessionRuntime(
          sessionId,
          configStore,
          credentialStore,
          approvalPolicy,
          runtimeStateRepo,
          toolRegistry,
          sessionDir,
        ),
    )
    const runtimeFactory = createPiAgentRuntimeFactory(sessionRuntimeManager)
    const sessionRepo = new DrizzleAgentSessionRepo(db)
    const runRepo = new DrizzleAgentRunRepo(db)
    const executionRecordRepo = new DrizzleAgentExecutionRecordRepo(db)
    const artifactRepo = new DrizzleArtifactRepo(db)
    const agentService = new AgentService(
      runtimeFactory,
      sessionRepo,
      runRepo,
      executionRecordRepo,
      artifactRepo,
    )
    const artifactService = new ArtifactService(artifactRepo, workspace)

    await agentService.initialize()
    const messageProjection = new MessageProjectionService(new DrizzleAgentMessageRepo(db))
    const contextAttachments = new ContextAttachmentService()
    const contextBuilder = new ContextBuilder(contextAttachments)
    const piClientService = new PiClientService(
      agentService,
      sessionRuntimeManager,
      messageProjection,
      configStore,
      artifactService,
      contextBuilder,
      contextAttachments,
    )
    const piClient = createPiNodeClientAdapter(piClientService, {
      workspacePath: workspace(),
      agentDir: sessionDir,
    })
    server = await startAgentHttpServer(piClient, {
      allowedOrigins: options.allowedOrigins,
    })

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
          case 'agent-run:list':
            return agentService.listRuns(request.request.sessionId)
          case 'agent-execution-record:list':
            return agentService.listExecutionRecords(request.request.runId)
          case 'pi:call':
            return invokePiClientCall(piClient, request.call)
        }
      },
      subscribePi(request, listener) {
        return piClient.subscribe(request.threadId, listener, request.options)
      },
      async close() {
        await server?.close()
        contextAttachments.clear()
        piClientService.dispose()
        sessionRuntimeManager.dispose()
        closeDb()
      },
    }
  } catch (error) {
    await server?.close()
    closeDb()
    throw error
  }
}

function invokePiClientCall(client: ContextAwarePiClient, call: PiClientCall): Promise<unknown> {
  switch (call.method) {
    case 'listThreads':
      return client.listThreads(...call.args)
    case 'createThread':
      return client.createThread(...call.args)
    case 'getThread':
      return client.getThread(...call.args)
    case 'sendMessage':
      return client.sendMessage(...call.args)
    case 'cancelRun':
      return client.cancelRun(...call.args)
    case 'clearQueue':
      return client.clearQueue(...call.args)
    case 'getAvailableModels':
      return client.getAvailableModels(...call.args)
    case 'setModel':
      return client.setModel(...call.args)
    case 'setThinkingLevel':
      return client.setThinkingLevel(...call.args)
    case 'renameThread':
      return client.renameThread(...call.args)
    case 'archiveThread':
      return client.archiveThread(...call.args)
    case 'unarchiveThread':
      return client.unarchiveThread(...call.args)
    case 'deleteThread':
      return client.deleteThread(...call.args)
    case 'respondToHostUiRequest':
      return client.respondToHostUiRequest(...call.args)
  }
}

function createCredentialStore(apiKeys: Record<string, string>): MemoryCredentialStore {
  const store = new MemoryCredentialStore()
  for (const [provider, apiKey] of Object.entries(apiKeys)) store.setApiKey(provider, apiKey)
  return store
}
