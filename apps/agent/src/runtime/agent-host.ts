import type { Context } from '@earendil-works/chord'
import {
  createRegistry,
  defineExtension,
  InboxDoc,
  type ConversationId,
  type Extension,
  type HarnessSettings,
  type ModelRef,
} from '@earendil-works/pi-durable'
import type { AgentConfig } from '@kklyeenook/shared/agent/agentConfig'
import { getAgentCompactionSettings } from '@kklyeenook/shared/agent/agentConfig'
import {
  effectivePermissionMode,
  type PermissionMode,
} from '@kklyeenook/shared/approval/permission'
import { webSearchCredentialId } from '@kklyeenook/shared/web-search/webSearch'
import type { CredentialStore } from '../settings/credentialStore'
import type { AgentSessionRepo } from '../db/repositories/agent-session-repo'
import type { ToolRegistry } from '../tools/toolRegistry'
import type { ToolResultRetentionPolicy } from '../tools/toolResultRetentionPolicy'
import type { SandboxService } from '../sandbox/sandbox-service'
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
import { submissionRegistry } from './submission-config'
import type { BotSubmissionConfig } from './inputs'
import type { BotProfile } from '@kklyeenook/shared/bot/bot'
import { botState } from '@kklyeenook/shared/bot/bot-state'
import type { GroveRepo } from '../db/repositories/grove-repo'
import { BotCoordinationService } from '../bots/bot-coordination-service'
import { BotActivityService } from '../bots/bot-activity-service'
import { registerBotCoordinationTools } from '../tools/bot-coordination-tools'
import type { RemoteTransport } from '../grove/remote-transport'
import type { CapabilityRuntime } from '../grove/capability-runtime'

export type AgentHostOptions = {
  databasePath: string
  config: () => AgentConfig
  credentials: () => CredentialStore
  sessions: AgentSessionRepo
  botRepo?: BotRepo
  groveRepo?: GroveRepo
  groveTransport?: RemoteTransport
  groveCapabilities?: CapabilityRuntime
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
  stopping = false
  scheduledTasks?: () => Promise<import("@kklyeenook/shared/scheduler/scheduled-task").ScheduledTask[]>
  readonly activity = new BotActivityService(this)
  readonly grove?: BotCoordinationService
  readonly coordination?: BotCoordinationService

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
    grove?: BotCoordinationService,
  ) {
    this.bots = bots
    this.grove = grove
    this.coordination = grove
    this.conversations = new ConversationService(
      engine,
      options.sessions,
      inputs,
      async (threadId, update, context) => {
        if (!bots) return
        const record = await options.sessions.findById(threadId)
        if (!record?.botId) throw new BotError(403, 'Conversation has no Bot identity')
        const bot = await bots.get(record.botId)
        if (update.workspaceId !== undefined && update.workspaceId !== record.workspaceId) {
          if (isDurableRunning(await this.conversations.snapshot(threadId, context)))
            throw new BotError(409, 'Cannot change Workspace while Tasks are running')
          await bots.assertAccess(bot.id, update.workspaceId)
        }
        if (update.permissionMode) {
          const modes = ['read-only', 'workspace-write', 'full-access']
          if (modes.indexOf(update.permissionMode) > modes.indexOf(bot.permissionMode))
            throw new BotError(403, 'Thread permission exceeds Bot permission')
        }
      },
      bots
        ? async (threadId, action) => {
            const record = await options.sessions.findById(threadId)
            if (!record?.botId) throw new BotError(404, 'Conversation not found')
            return bots.withLock(record.botId, action)
          }
        : undefined,
      grove ? (threadId, input, context) => grove.submitMentions(threadId, input, context) : undefined,
    )
  }

  static async open(options: AgentHostOptions, context: Context) {
    let host: AgentHost | undefined
    const grove = options.botRepo && options.groveRepo ? new BotCoordinationService(options.groveRepo, options.groveTransport, options.groveCapabilities) : undefined
    const unregisterGrove = grove ? registerBotCoordinationTools(options.tools, () => host!) : []
    const models = new AgentModels(options.config, options.credentials)
    const bots = options.botRepo
      ? new BotService(
          options.botRepo,
          options.sessions,
          options.workspaces,
          options.tools,
          (bot) => {
            if (bot.model && !models.models.getModel(bot.model.provider, bot.model.modelId))
              throw new BotError(400, 'Model is not configured')
          },
        )
      : undefined
    await bots?.initialize()
    const registry = createRegistry()
    const contexts = new ExecutionContextService(
      options.sessions,
      options.workspaces,
      () => options.config().defaultPermissionMode ?? 'workspace-write',
    )
    let engine: AgentEngine
    let inputs: AgentInputs
    const loader = new AgentInstructions()
    const executionContext = async (id: ConversationId, context: Context, toolName?: string, callId?: string) => {
      const owner = await engine.ownerThread(id, context)
      const resolved = await contexts.resolve(owner.threadId)
      if (!bots) return resolved
      const record = await options.sessions.findById(owner.threadId)
      if (!record?.botId) throw new BotError(403, 'Conversation has no Bot identity')
      const captured = await inputs?.activeConfig(id, engine.harness, context)
      const groveTaskId = await inputs?.activeGroveTask(id, context)
      if (groveTaskId && toolName) {
        if (await inputs.activeGroveContinuation(id, context)) await grove?.guardContinuation(groveTaskId, context, toolName)
        else await grove?.guardExecution(groveTaskId, context, toolName, callId)
      }
      const workspaceId = captured ? captured.workspaceId : record.workspaceId
      const bot = await bots.assertAccess(record.botId, workspaceId, toolName)
      if (captured && toolName && !captured.tools.includes(toolName))
        throw new BotError(403, 'Tool was not enabled when this Submission was admitted')
      const modes = [resolved.mode, bot.permissionMode, captured?.permissionMode ?? resolved.mode]
      const order = ['read-only', 'workspace-write', 'full-access'] as const
      return {
        ...resolved,
        botId: bot.id,
        mode: order[Math.min(...modes.map((mode) => order.indexOf(mode)))]!,
      }
    }
    const resources = new RunResources(options.sandbox, options.onReport)
    const tools = new AgentTools(
      options.tools,
      options.sandbox,
      options.retention,
      async (id, context, toolName, callId) => {
        const resolved = await executionContext(id, context, toolName, callId)
        return { executionContext: resolved, cwd: resolved.workspace?.rootPath }
      },
      resources,
    )
    const capture = async (
      id: ConversationId,
      context: Context,
    ): Promise<BotSubmissionConfig | undefined> => {
      if (!bots) return undefined
      const owner = await engine.ownerThread(id, context)
      if (owner.conversationId !== id) {
        const parent = await inputs.activeConfig(owner.conversationId, engine.harness, context)
        if (parent)
          return { ...parent, tools: parent.tools.filter((name) => name !== 'delegate_task') }
      }
      const record = await options.sessions.findById(owner.threadId)
      if (!record?.botId) throw new BotError(403, 'Conversation has no Bot identity')
      const bot = await bots.assertAccess(record.botId, record.workspaceId)
      const resolved = await contexts.resolve(owner.threadId)
      const modes = ['read-only', 'workspace-write', 'full-access'] as const
      const mode = modes[Math.min(modes.indexOf(resolved.mode), modes.indexOf(bot.permissionMode))]!
      const selected = models.selection()
      const model = bot.model ?? selected.model
      const tools = bot.enabledTools.filter(
        (name) => options.tools.get(name) || name === 'delegate_task',
      )
      const files =
        bot.kind === 'coding' && resolved.workspace
          ? await loader.load({ workspaceRoot: resolved.workspace.rootPath })
          : []
      return {
        profile: bot,
        workspaceId: record.workspaceId ?? null,
        permissionMode: mode,
        tools,
        agent: {
          model: model ?? undefined,
          thinkingLevel: bot.thinkingLevel ?? selected.thinkingLevel ?? 'off',
          instructions:
            `You are ${bot.name}. Your role: ${bot.role}.\n${bot.instructions}` +
            (bot.kind === 'coding'
              ? '\n' + shellRuntimeContext(resolved.workspace?.rootPath)
              : '') +
            files
              .map((file) => `\nWorkspace instructions from ${file.path}:\n${file.content}`)
              .join(''),
          cwd: resolved.workspace?.rootPath,
        },
      }
    }
    inputs = new AgentInputs(
      options.contextBuilder,
      options.skills,
      async (id, context) => (await executionContext(id, context)).workspaceId,
      capture,
      bots
        ? async (id, action, context) => {
            const owner = await engine.ownerThread(id, context)
            const record = await options.sessions.findById(owner.threadId)
            if (!record?.botId || record.deletedAt)
              throw new BotError(404, 'Conversation not found')
            return bots.withLock(record.botId, async () => {
              await bots.assertAccess(record.botId!, record.workspaceId)
              return action()
            })
          }
        : undefined,
      grove ? async (id, context) => {
        const owner = await engine.ownerThread(id, context)
        return (await grove.mentionTargets(owner.threadId, context)).filter((bot) => bot.allowed).map((bot) => ({ id: bot.botId, name: bot.name, role: bot.role, transport: 'local' }))
      } : undefined,
    )
    const delegation = new AgentDelegation(inputs, async (id, context) => {
      await executionContext(id, context, 'delegate_task')
    })
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
    const botIdentity = defineExtension({ name: 'nook.bot' })
    registry.install(botIdentity)
    if (grove) registry.install(grove.extension)
    for (const extension of options.extensions ?? []) registry.install(extension)
    for (const extension of tools.extensions()) registry.install(extension)
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
    try {
      engine = await AgentEngine.open(
        options.databasePath,
        {
          models: models.models,
          registry: bots ? submissionRegistry(registry, inputs, (taskId, generationId, result, context) => grove?.guardGeneration(taskId, generationId, result, context) ?? Promise.resolve()) : registry,
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
            grove,
          )
          await resources.connect(initializing, context)
          await initializing.harness.commit(async (tx) => {
            await tx.doc(approvalSignalDoc)
          }, context)
          for (const id of Object.values(await initializing.links(context))) {
            await initializing.harness.commit(async (tx) => {
              await tx.doc(approvalDoc, id)
            }, context)
          }
          await grove?.connect(host, context)
          await options.initialize?.(host, context)
        },
      )
    } catch (error) {
      for (const unregister of unregisterGrove) unregister()
      try {
        await resources.close(async () => {})
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Agent initialization and resource cleanup failed',
        )
      }
      throw error
    }
    if (!host) throw new Error('Agent host failed to initialize')
    host.unregisterGrove = unregisterGrove
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
    if (this.bots)
      return this.bots.withLock(input.botId ?? 'xiaoya', () => this.createThread(input, context))
    return this.createThread(input, context)
  }

  private async createThread(input: Parameters<AgentHost['create']>[0], context: Context) {
    const bot = this.bots ? await this.bots.get(input.botId ?? 'xiaoya') : undefined
    if (bot) {
      input = {
        ...input,
        botId: bot.id,
        workspaceId: input.workspaceId === undefined ? bot.defaultWorkspaceId : input.workspaceId,
      }
      await this.bots!.assertAccess(bot.id, input.workspaceId)
      const existing = await this.options.sessions.findById(input.threadId)
      if (existing && existing.botId !== bot.id)
        throw new BotError(409, 'Thread belongs to another Bot')
      if (existing && existing.workspaceId !== input.workspaceId)
        throw new BotError(409, 'Thread belongs to another Workspace')
      const modes = ['read-only', 'workspace-write', 'full-access']
      if (
        input.permissionMode &&
        modes.indexOf(input.permissionMode) > modes.indexOf(bot.permissionMode)
      )
        throw new BotError(403, 'Thread permission exceeds Bot permission')
      if (!existing && (input.model || input.thinkingLevel))
        await this.bots!.update(bot.id, {
          ...(input.model ? { model: input.model } : {}),
          ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
        })
    }
    const workspace = input.workspaceId
      ? await this.options.workspaces.resolve(input.workspaceId)
      : undefined
    const permissionMode = effectivePermissionMode(
      input.permissionMode ?? bot?.permissionMode,
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
          ...(bot?.model ? { model: bot.model } : {}),
          ...(bot?.thinkingLevel ? { thinkingLevel: bot.thinkingLevel } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
          extensions: [
            bot
              ? defineExtension({ name: 'nook.bot' })
              : workspace
                ? this.identities.coding
                : this.identities.personal,
            ...this.tools.extensions(),
            this.tools.approvals.extension,
            this.inputs.extension,
            this.membership,
            this.delegation.extension,
            ...(this.options.extensions ?? []),
          ],
          tools: this.enabledTools(bot),
          cwd: workspace?.status === 'attached' ? workspace.rootPath : undefined,
        },
      },
      context,
    )
  }

  install(extension: Extension) {
    this.registry.install(extension)
  }

  workspaces() {
    return this.options.workspaces.list()
  }
  availableTools() {
    return [
      ...this.options.tools.list().map(({ name, description }) => ({ name, description })),
      { name: 'delegate_task', description: this.delegation.tool.description },
    ]
  }

  async botSummaries(context: Context) {
    const bots = (await this.bots?.list()) ?? []
    const threads = await this.conversations.list(context)
    const priorities = ['idle', 'completed', 'error', 'thinking', 'working', 'waiting'] as const
    return Promise.all(
      bots.map(async (bot) => {
        let state: (typeof priorities)[number] = 'idle'
        for (const thread of threads.filter((thread) => thread.botId === bot.id)) {
          const current = botState(
            await this.conversations.snapshot(thread.id, context),
            (await this.pendingApprovals(thread.id, context)).length > 0,
          )
          if (priorities.indexOf(current) > priorities.indexOf(state)) state = current
        }
        return { ...bot, state }
      }),
    )
  }

  async mainThread(botId: string, context: Context) {
    if (!this.bots) throw new BotError(404, 'Bot service not configured')
    const bot = await this.bots.get(botId)
    const existing = await this.options.sessions.findById(bot.mainThreadId)
    if (existing && Object.hasOwn(await this.engine.links(context), existing.id))
      return this.conversations.get(existing.id, context)
    return this.create(
      {
        threadId: bot.mainThreadId,
        botId: bot.id,
        title: '主会话',
        workspaceId: bot.defaultWorkspaceId,
      },
      context,
    )
  }

  async assertExtraThread(threadId: string, context: Context) {
    const thread = await this.conversations.get(threadId, context)
    if (thread.botId && this.bots && (await this.bots.get(thread.botId)).mainThreadId === threadId)
      throw new BotError(409, 'The main conversation cannot be archived or deleted')
  }

  async deleteBot(botId: string, context: Context) {
    const bots = this.bots
    if (!bots) throw new BotError(404, 'Bot service not configured')
    return bots.withLock(botId, async () => {
      const bot = await bots.get(botId)
      if (bot.isBuiltIn) throw new BotError(409, 'Built-in Bots cannot be deleted')
      const threads = (await this.conversations.list(context)).filter(
        (thread) => thread.botId === botId,
      )
      for (const thread of threads) {
        const snapshot = await this.conversations.snapshot(thread.id, context)
        const conversation = await this.engine.conversation(thread.id, context)
        const queue = await this.engine.harness.snapshot(InboxDoc, conversation.id, context)
        if (isDurableRunning(snapshot) || queue?.items.length)
          throw new BotError(409, 'Bot has running or queued Tasks')
      }
      for (const thread of threads) await this.conversations.archive(thread.id, true, context)
      await bots.remove(botId)
    })
  }

  async refreshTools(context: Context) {
    for (const extension of this.tools.extensions()) this.registry.install(extension)
    if (this.bots) return
    const tools = this.enabledTools()
    for (const record of await this.conversations.list(context)) {
      await (await this.engine.conversation(record.id, context)).configure({ tools }, context)
    }
  }

  async reload(context: Context) {
    this.models.reload()
    await this.options.skills.reload()
    await this.refreshTools(context)
    if (this.bots) return
    const selection = this.models.selection()
    for (const record of await this.conversations.list(context)) {
      await (await this.engine.conversation(record.id, context)).configure(selection, context)
    }
  }

  async configure(
    threadId: string,
    change: {
      model?: ModelRef
      thinkingLevel?: import('@earendil-works/pi-ai').ModelThinkingLevel
    },
    context: Context,
  ) {
    if (this.bots) {
      const record = await this.conversations.get(threadId, context)
      if (!record.botId) throw new BotError(403, 'Conversation has no Bot identity')
      await this.bots.update(record.botId, change)
      return
    }
    await (await this.engine.conversation(threadId, context)).configure(change, context)
  }

  async pendingApprovals(threadId: string, context: Context) {
    const approvals: import('@kklyeenook/shared/agent/chat-protocol').AgentApproval[] = []
    for (const id of await this.engine.ownedConversationIds(threadId, context)) {
      approvals.push(...(await this.tools.approvals.pending(id, context)))
    }
    return approvals
  }

  async decideApproval(
    threadId: string,
    id: string,
    state: 'approved' | 'rejected',
    context: Context,
  ) {
    const conversationId = Number(id.split(':', 1)[0])
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0)
      throw new Error('Approval not found')
    const owner = await this.engine.ownerThread(conversationId as ConversationId, context)
    if (owner.threadId !== threadId) throw new Error('Approval not found')
    return this.tools.approvals.decide(conversationId as ConversationId, id, state, context)
  }

  close() {
    this.stopping = true
    return this.resources.close(() => this.engine.close()).finally(() => {
      for (const unregister of this.unregisterGrove) unregister()
    })
  }

  private unregisterGrove: Array<() => void> = []

  private enabledTools(bot?: BotProfile) {
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
        .extensions()
        .flatMap((extension) => extension.tools!)
        .filter(
          (tool) =>
            (bot ? bot.enabledTools.includes(tool.name) : names.has(tool.name)) &&
            tool.name !== 'delegate_task',
        ),
      ...((bot ? bot.enabledTools.includes('delegate_task') : names.has('delegate_task'))
        ? [this.delegation.tool]
        : []),
    ]
  }
}
