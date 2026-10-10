import type { Context } from '@earendil-works/chord'
import {
  createRegistry,
  type ConversationId,
  type Extension,
  type HarnessSettings,
} from '@earendil-works/pi-durable'
import type { AgentConfig } from '@/shared/agent/agentConfig'
import { getAgentCompactionSettings } from '@/shared/agent/agentConfig'
import { effectivePermissionMode, type PermissionMode } from '@/shared/approval/permission'
import { webSearchCredentialId } from '@/shared/web-search/webSearch'
import type { CredentialStore } from '../settings/credentialStore'
import type { AgentSessionRepo } from '../db/repositories/agentSessionRepo'
import type { ToolRegistry } from '../tools/toolRegistry'
import type { ToolResultRetentionPolicy } from '../tools/toolResultRetentionPolicy'
import type { SandboxService } from '../sandbox/sandboxService'
import { shellRuntimeContext } from '../sandbox/shellRuntime'
import type { WorkspaceService } from '../workspace/workspaceService'
import { ExecutionContextService } from '../workspace/executionContextService'
import type { ContextBuilder } from '../context/contextBuilder'
import type { SkillLoader } from '../agent-backend/skillLoader'
import { AgentEngine } from './agent-engine'
import { AgentModels } from './agent-models'
import { AgentInstructions, createAgentInstructions } from './agent-instructions'
import { ConversationService } from './conversation-service'
import { DurableTools } from './durable-tools'
import { approvalDoc } from './durable-approvals'
import { DurableInputs } from './durable-inputs'

export type AgentHostOptions = {
  databasePath: string
  config: () => AgentConfig
  credentials: () => CredentialStore
  sessions: AgentSessionRepo
  workspaces: WorkspaceService
  tools: ToolRegistry
  sandbox: SandboxService
  retention: ToolResultRetentionPolicy
  contextBuilder: ContextBuilder
  skills: SkillLoader
  onReport?: (error: unknown) => void
}

export class AgentHost {
  readonly conversations: ConversationService

  private constructor(
    readonly engine: AgentEngine,
    readonly models: AgentModels,
    readonly tools: DurableTools,
    readonly inputs: DurableInputs,
    private readonly options: AgentHostOptions,
    private readonly registry: ReturnType<typeof createRegistry>,
    private readonly identities: { coding: Extension; personal: Extension },
  ) {
    this.conversations = new ConversationService(engine, options.sessions, inputs)
  }

  static async open(options: AgentHostOptions, context: Context) {
    const models = new AgentModels(options.config, options.credentials)
    const registry = createRegistry()
    const contexts = new ExecutionContextService(
      options.sessions,
      options.workspaces,
      () => options.config().defaultPermissionMode ?? 'workspace-write',
    )
    let engine: AgentEngine
    const executionContext = async (id: ConversationId, context: Context) => {
      const links = await engine.links(context)
      const threadId = Object.keys(links).find((threadId) => links[threadId] === id)
      if (!threadId) throw new Error('Conversation has no authorized business metadata')
      return contexts.resolve(threadId)
    }
    const tools = new DurableTools(
      options.tools,
      options.sandbox,
      options.retention,
      async (id, context) => {
        const resolved = await executionContext(id, context)
        return { executionContext: resolved, cwd: resolved.workspace?.rootPath }
      },
    )
    const inputs = new DurableInputs(
      options.contextBuilder,
      options.skills,
      async (id, context) => (await executionContext(id, context)).workspaceId,
    )
    const loader = new AgentInstructions()
    const identities = {
      coding: createAgentInstructions({
        identity: 'coding',
        loader,
        workspace: async (id, context) => {
          const resolved = await executionContext(id, context)
          return resolved.workspace ? { workspaceRoot: resolved.workspace.rootPath } : undefined
        },
        environment: async (input, context) => {
          const resolved = await executionContext(input.conversationId, context)
          return (
            shellRuntimeContext(resolved.workspace?.rootPath) +
            '\nCurrent permission mode: ' +
            resolved.mode
          )
        },
      }),
      personal: createAgentInstructions({
        identity: 'personal',
        loader,
        workspace: async () => undefined,
      }),
    }
    registry.install(identities.coding)
    registry.install(identities.personal)
    registry.install(tools.extension())
    registry.install(tools.approvals.extension)
    registry.install(inputs.extension)
    await options.skills.reload()
    const settings: HarnessSettings = {
      extensions: [],
      get compaction() {
        return getAgentCompactionSettings(options.config())
      },
    }
    engine = await AgentEngine.open(
      options.databasePath,
      { models: models.models, registry, settings, onReport: options.onReport },
      context,
      async (initializing) => {
        engine = initializing
        tools.connect(initializing.harness)
        inputs.connect(initializing.harness)
        for (const id of Object.values(await initializing.links(context))) {
          await initializing.harness.commit(async (tx) => {
            await tx.doc(approvalDoc, id)
          }, context)
        }
      },
    )
    return new AgentHost(engine, models, tools, inputs, options, registry, identities)
  }

  async create(
    input: {
      threadId: string
      title?: string
      workspaceId?: string | null
      permissionMode?: PermissionMode
    },
    context: Context,
  ) {
    const workspace = input.workspaceId
      ? await this.options.workspaces.resolve(input.workspaceId)
      : undefined
    const permissionMode = effectivePermissionMode(
      input.permissionMode,
      workspace?.status === 'attached',
      this.options.config().defaultPermissionMode,
    )
    return this.conversations.create(
      {
        ...input,
        permissionMode,
        initialize: async (tx, id) => {
          await tx.doc(approvalDoc, id)
        },
        agent: {
          ...this.models.selection(),
          extensions: [
            workspace ? this.identities.coding : this.identities.personal,
            this.tools.extension(),
            this.tools.approvals.extension,
            this.inputs.extension,
          ],
          tools: this.enabledTools(),
          cwd: workspace?.status === 'attached' ? workspace.rootPath : undefined,
        },
      },
      context,
    )
  }

  async refreshTools(context: Context) {
    this.registry.install(this.tools.extension())
    const tools = this.enabledTools()
    for (const record of await this.conversations.list(context)) {
      await (await this.engine.conversation(record.id, context)).configure({ tools }, context)
    }
  }

  async reload(context: Context) {
    this.models.reload()
    await this.options.skills.reload()
    await this.refreshTools(context)
    const selection = this.models.selection()
    for (const record of await this.conversations.list(context)) {
      await (await this.engine.conversation(record.id, context)).configure(selection, context)
    }
  }

  close() {
    return this.engine.close()
  }

  private enabledTools() {
    const config = this.options.config()
    const webProvider = config.webSearch?.provider ?? 'disabled'
    const names = new Set(
      config.tools.enabled.filter((name) => name !== 'web_search' && !name.startsWith('mcp__')),
    )
    if (
      webProvider !== 'disabled' &&
      this.options.credentials().hasApiKey(webSearchCredentialId(webProvider))
    )
      names.add('web_search')
    for (const tool of this.options.tools.list()) {
      if (tool.origin?.kind === 'mcp' || tool.name === 'read_tool_result') names.add(tool.name)
    }
    return this.tools.extension().tools!.filter((tool) => names.has(tool.name))
  }
}
