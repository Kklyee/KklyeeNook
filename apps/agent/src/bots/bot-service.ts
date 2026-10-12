import { randomUUID } from 'node:crypto'
import { defaultBot, type BotInput, type BotProfile } from '@kklyeenook/shared/bot/bot'
import { GROVE_TOOLS } from '@kklyeenook/shared/bot/grove'
import type { BotRepo } from '../db/repositories/bot-repo'
import type { AgentSessionRepo } from '../db/repositories/agent-session-repo'
import type { WorkspaceService } from '../workspace/workspaceService'
import type { ToolRegistry } from '../tools/toolRegistry'

export class BotError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

export class BotService {
  private readonly locks = new Map<string, Promise<void>>()
  constructor(
    private readonly repo: BotRepo,
    private readonly sessions: AgentSessionRepo,
    private readonly workspaces: WorkspaceService,
    private readonly tools: ToolRegistry,
    private readonly validateModel: (bot: BotProfile) => void = () => {},
  ) {}

  async initialize() {
    const legacy = (await this.sessions.findAll()).filter((thread) => !thread.botId)
    const coder = defaultBot('coder', 'Coder', true)
    coder.workspaceIds = [
      ...new Set(legacy.flatMap((thread) => (thread.workspaceId ? [thread.workspaceId] : []))),
    ]
    await this.repo.insert(defaultBot('xiaoya', '小芽'))
    await this.repo.insert(coder)
    for (const bot of await this.repo.list()) {
      const enabledTools = [...new Set(bot.enabledTools.map((name) =>
        name.startsWith('bot.') && GROVE_TOOLS.includes(name.slice(4) as typeof GROVE_TOOLS[number])
          ? name.slice(4)
          : name,
      ))]
      if (JSON.stringify(enabledTools) !== JSON.stringify(bot.enabledTools))
        await this.repo.save({ ...bot, enabledTools, updatedAt: Date.now() })
    }
    if (GROVE_TOOLS.every((name) => this.tools.get(name))) {
      for (const id of ['xiaoya', 'coder']) {
        const bot = await this.get(id)
        const defaults = defaultBot(id, '', id === 'coder').enabledTools
        const legacy = defaults.filter((name) => !GROVE_TOOLS.includes(name as typeof GROVE_TOOLS[number]))
        if (bot.enabledTools.length === legacy.length && legacy.every((name) => bot.enabledTools.includes(name)))
          await this.repo.save({ ...bot, enabledTools: defaults, updatedAt: Date.now() })
      }
    }
    const existingCoder = await this.get('coder')
    if (
      existingCoder.instructions ===
      'Help with code development, documentation, debugging and tests. Follow the authorized workspace instructions and request approval for side effects when required.'
    )
      await this.repo.save({
        ...existingCoder,
        instructions: coder.instructions,
        updatedAt: Date.now(),
      })
    for (const thread of legacy) {
      const botId = thread.workspaceId ? 'coder' : 'xiaoya'
      if (thread.workspaceId) {
        const bot = await this.get(botId)
        if (!bot.workspaceIds.includes(thread.workspaceId))
          await this.repo.save({ ...bot, workspaceIds: [...bot.workspaceIds, thread.workspaceId] })
      }
      await this.sessions.save({ ...thread, botId })
    }
  }

  list() {
    return this.repo.list()
  }

  async withLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    this.locks.set(id, next)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.locks.get(id) === next) this.locks.delete(id)
    }
  }

  async get(id: string) {
    const bot = await this.repo.get(id)
    if (!bot) throw new BotError(404, 'Bot not found')
    return bot
  }

  async create(input: BotInput) {
    const id = randomUUID()
    const initial = { ...defaultBot(id, input.name), ...input }
    if (initial.avatar.seed.startsWith('draft:')) initial.avatar = { ...initial.avatar, seed: id }
    const bot = await this.validate(initial)
    await this.repo.insert(bot)
    return bot
  }

  async update(id: string, input: Partial<BotInput>) {
    const current = await this.get(id)
    const bot = await this.validate({
      ...current,
      ...input,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    })
    await this.repo.save(bot)
    return bot
  }

  async duplicate(id: string) {
    const bot = await this.get(id)
    const {
      id: _id,
      mainThreadId: _main,
      isBuiltIn: _builtIn,
      createdAt: _created,
      updatedAt: _updated,
      ...input
    } = bot
    return this.create({ ...input, name: `${bot.name} 副本` })
  }

  async reset(id: string) {
    const current = await this.get(id)
    if (!current.isBuiltIn) throw new BotError(400, 'Only built-in Bots can restore defaults')
    const bot = {
      ...defaultBot(id, id === 'coder' ? 'Coder' : '小芽', id === 'coder'),
      createdAt: current.createdAt,
      mainThreadId: current.mainThreadId,
    }
    await this.repo.save(bot)
    return bot
  }

  async remove(id: string) {
    const bot = await this.get(id)
    if (bot.isBuiltIn) throw new BotError(409, 'Built-in Bots cannot be deleted')
    await this.repo.remove(id)
  }

  async assertAccess(id: string, workspaceId?: string | null, toolName?: string) {
    const bot = await this.get(id)
    if (workspaceId && !bot.workspaceIds.includes(workspaceId))
      throw new BotError(403, 'Workspace access has been revoked for this Bot')
    if (workspaceId && (await this.workspaces.resolve(workspaceId)).status !== 'attached')
      throw new BotError(403, 'Workspace is unavailable')
    if (toolName && !bot.enabledTools.includes(toolName))
      throw new BotError(403, `Tool is not enabled for this Bot: ${toolName}`)
    return bot
  }

  private async validate(bot: BotProfile) {
    bot.name = bot.name.trim()
    if (!bot.name) throw new BotError(400, 'Bot name is required')
    bot.workspaceIds = [...new Set(bot.workspaceIds)]
    bot.enabledTools = [...new Set(bot.enabledTools)]
    if (bot.defaultWorkspaceId && !bot.workspaceIds.includes(bot.defaultWorkspaceId))
      throw new BotError(400, 'Default Workspace must be authorized')
    for (const id of bot.workspaceIds) await this.workspaces.resolve(id)
    for (const name of bot.enabledTools) {
      if (
        !this.tools.get(name) &&
        name !== 'delegate_task' &&
        !defaultBot('coder', '', true).enabledTools.includes(name) &&
        !defaultBot('xiaoya', '').enabledTools.includes(name)
      )
        throw new BotError(400, `Unknown tool: ${name}`)
    }
    this.validateModel(bot)
    return bot
  }
}
