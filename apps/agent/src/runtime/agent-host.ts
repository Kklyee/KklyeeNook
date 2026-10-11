import type { Context } from '@earendil-works/chord'
import {
  createRegistry,
  type ConversationId,
  type Extension,
  type HarnessSettings,
  type ModelRef,
} from '@earendil-works/pi-durable'
import type { AgentConfig } from '@kklyeenook/shared/agent/agentConfig'
import { getAgentCompactionSettings } from '@kklyeenook/shared/agent/agentConfig'
import { effectivePermissionMode, type PermissionMode } from '@kklyeenook/shared/approval/permission'
import { webSearchCredentialId } from '@kklyeenook/shared/web-search/webSearch'
import type { CredentialStore } from '../settings/credentialStore'
import type { AgentSessionRepo } from '../db/repositories/agent-session-repo'
import type { ToolRegistry } from '../tools/toolRegistry'
import type { ToolResultRetentionPolicy } from '../tools/toolResultRetentionPolicy'
import type { SandboxService } from '../sandbox/sandboxService'
import { shellRuntimeContext } from '../sandbox/shellRuntime'
import type { WorkspaceService } from '../workspace/workspaceService'
import { ExecutionContextService } from '../workspace/executionContextService'
import type { ContextBuilder } from '../context/contextBuilder'
import type { SkillLoader } from '../backend/skillLoader'
import { AgentEngine } from './agent-engine'
import { AgentModels } from './agent-models'
import { AgentInstructions, createAgentInstructions } from './agent-instructions'
import { ConversationService } from './conversation-service'
import { AgentTools } from './tools'
import { approvalDoc, approvalSignalDoc } from './approvals'
import { AgentInputs } from './inputs'
import { AgentDelegation } from './delegation'
import { RunResources } from './run-resources'
import { createRunMembershipExtension } from './run-membership'
import type { BotRepo } from '../db/repositories/bot-repo'
import { BotService, BotError } from '../bots/bot-service'
import { isDurableRunning } from './projection'

export type AgentHostOptions = {
  databasePath: string
  config: () => AgentConfig
  credentials: () => CredentialStore
  sessions: AgentSessionRepo
  botRepo?: BotRepo
  workspaces: WorkspaceService
  tools: ToolRegistry
  sandbox: SandboxService
  retention: ToolResultRetentionPolicy
  contextBuilder: ContextBuilder
  skills: SkillLoader
  onReport?: (error: unknown) => void
  extensions?: readonly Extension[]
  initialize?: (host: AgentHost, context: Context) => Promise<void>
}

export class AgentHost {
  readonly conversations: ConversationService
  readonly bots?: BotService

  private constructor(
    readonly engine: AgentEngine,
    readonly models: AgentModels,
    readonly tools: AgentTools,
    readonly inputs: AgentInputs,
    readonly delegation: AgentDelegation,
    readonly resources: RunResources,
    private readonly options: AgentHostOptions,
    private readonly registry: ReturnType<typeof createRegistry>,
    private readonly identities: { coding: Extension; personal: Extension },
    private readonly membership: Extension,
    bots?: BotService,
  ) {
    this.conversations = new ConversationService(engine, options.sessions, inputs)
    this.bots = bots
  }

  static async open(options: AgentHostOptions, context: Context) {
    const models = new AgentModels(options.config, options.credentials)
    const bots = options.botRepo ? new BotService(options.botRepo, options.sessions, options.workspaces, options.tools, (bot) => {
      if (bot.model && !models.models.getModel(bot.model.provider, bot.model.modelId)) throw new BotError(400, 'Model is not configured')
    }) : undefined
    await bots?.initialize()
    const registry = createRegistry()
    const contexts = new ExecutionContextService(
      options.sessions,
      options.workspaces,
      () => options.config().defaultPermissionMode ?? 'workspace-write',
    )
    let engine: AgentEngine
    const executionContext = async (id: ConversationId, context: Context) => {
      const owner = await engine.ownerThread(id, context)
      return contexts.resolve(owner.threadId)
    }
    const resources = new RunResources(options.sandbox, options.onReport)
    const tools = new AgentTools(
      options.tools,
      options.sandbox,
      options.retention,
      async (id, context) => {
        const resolved = await executionContext(id, context)
        return { executionContext: resolved, cwd: resolved.workspace?.rootPath }
      },
      resources,
    )
    const inputs = new AgentInputs(
      options.contextBuilder,
      options.skills,
      async (id, context) => (await executionContext(id, context)).workspaceId,
    )
    const delegation = new AgentDelegation(inputs)
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
    for (const extension of options.extensions ?? []) registry.install(extension)
    registry.install(tools.extension())
    registry.install(tools.approvals.extension)
    registry.install(inputs.extension)
    const membership = createRunMembershipExtension(() => engine.harness)
    registry.install(membership)
    registry.install(delegation.extension)
    await options.skills.reload()
    const settings: HarnessSettings = {
      extensions: [],
      get compaction() {
        return getAgentCompactionSettings(options.config())
      },
    }
    let host: AgentHost | undefined
    try {
      engine = await AgentEngine.open(
        options.databasePath,
        {
          models: models.models,
          registry,
          settings,
          onReport: options.onReport,
          conversationCreated: async (tx, conversation) => {
            await tx.doc(approvalDoc, conversation.id)
          },
        },
        context,
        async (initializing) => {
          engine = initializing
          tools.connect(initializing.harness)
          inputs.connect(initializing.harness)
          delegation.connect(initializing.harness)
          host = new AgentHost(
            initializing,
            models,
            tools,
            inputs,
            delegation,
            resources,
            options,
            registry,
            identities,
            membership,
            bots,
          )
          await resources.connect(initializing, context)
          await initializing.harness.commit(async (tx) => { await tx.doc(approvalSignalDoc) }, context)
          for (const id of Object.values(await initializing.links(context))) {
            await initializing.harness.commit(async (tx) => {
              await tx.doc(approvalDoc, id)
            }, context)
          }
          await options.initialize?.(host, context)
        },
      )
    } catch (error) {
      try { await resources.close(async () => {}) }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Agent initialization and resource cleanup failed') }
      throw error
    }
    if (!host) throw new Error('Agent host failed to initialize')
    return host
  }

  async create(
    input: {
      threadId: string
      botId?: string
      title?: string
      workspaceId?: string | null
      permissionMode?: PermissionMode
      model?: ModelRef
      thinkingLevel?: import('@earendil-works/pi-ai').ModelThinkingLevel
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
          ...(input.model ? { model: input.model } : {}),
          ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
          extensions: [
            workspace ? this.identities.coding : this.identities.personal,
            this.tools.extension(),
            this.tools.approvals.extension,
            this.inputs.extension,
            this.membership,
            this.delegation.extension,
            ...(this.options.extensions ?? []),
          ],
          tools: this.enabledTools(),
          cwd: workspace?.status === 'attached' ? workspace.rootPath : undefined,
        },
      },
      context,
    )
  }

  install(extension: Extension) {
    this.registry.install(extension)
  }

  workspaces() { return this.options.workspaces.list() }
  availableTools() { return this.options.tools.list().map(({ name, description }) => ({ name, description })) }

  async mainThread(botId: string, context: Context) {
    if (!this.bots) throw new BotError(404, 'Bot service not configured')
    const bot = await this.bots.get(botId)
    return this.create({ threadId: bot.mainThreadId, botId: bot.id, title: '主会话', workspaceId: bot.defaultWorkspaceId }, context)
  }

  async deleteBot(botId: string, context: Context) {
    if (!this.bots) throw new BotError(404, 'Bot service not configured')
    const bot = await this.bots.get(botId)
    if (bot.isBuiltIn) throw new BotError(409, 'Built-in Bots cannot be deleted')
    const threads = (await this.conversations.list(context)).filter((thread) => thread.botId === botId)
    for (const thread of threads) {
      const snapshot = await this.conversations.snapshot(thread.id, context)
      if (isDurableRunning(snapshot)) throw new BotError(409, 'Bot has running Tasks')
    }
    for (const thread of threads) await this.conversations.archive(thread.id, true, context)
    await this.bots.remove(botId)
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

  async configure(threadId: string, change: { model?: ModelRef; thinkingLevel?: import('@earendil-works/pi-ai').ModelThinkingLevel }, context: Context) {
    await (await this.engine.conversation(threadId, context)).configure(change, context)
  }

  async pendingApprovals(threadId: string, context: Context) {
    const approvals: import('@kklyeenook/shared/agent/chat-protocol').AgentApproval[] = []
    for (const id of await this.engine.ownedConversationIds(threadId, context)) {
      approvals.push(...(await this.tools.approvals.pending(id, context)))
    }
    return approvals
  }

  async decideApproval(threadId: string, id: string, state: 'approved' | 'rejected', context: Context) {
    const conversationId = Number(id.split(':', 1)[0])
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) throw new Error('Approval not found')
    const owner = await this.engine.ownerThread(conversationId as ConversationId, context)
    if (owner.threadId !== threadId) throw new Error('Approval not found')
    return this.tools.approvals.decide(conversationId as ConversationId, id, state, context)
  }

  close() {
    return this.resources.close(() => this.engine.close())
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
    return [
      ...this.tools
        .extension()
        .tools!.filter((tool) => names.has(tool.name) && tool.name !== 'delegate_task'),
      ...(names.has('delegate_task') ? [this.delegation.tool] : []),
    ]
  }
}
