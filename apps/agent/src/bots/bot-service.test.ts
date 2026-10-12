import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { connectDatabase } from '../db/client'
import { DrizzleBotRepo } from '../db/repositories/bot-repo'
import { DrizzleAgentSessionRepo } from '../db/repositories/agent-session-repo'
import { DrizzleWorkspaceRepo } from '../db/repositories/workspaceRepo'
import { WorkspaceService } from '../workspace/workspaceService'
import { ToolRegistry } from '../tools/toolRegistry'
import { BotService } from './bot-service'

let close: () => void
let directory: string
let bots: BotService
let botRepo: DrizzleBotRepo
let sessions: DrizzleAgentSessionRepo
let workspaceId: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-bots-'))
  const connection = await connectDatabase(
    'file::memory:',
    fileURLToPath(new URL('../../drizzle', import.meta.url)),
  )
  close = connection.close
  sessions = new DrizzleAgentSessionRepo(connection.database)
  const workspaces = new WorkspaceService(new DrizzleWorkspaceRepo(connection.database))
  workspaceId = (await workspaces.attach(directory)).workspace!.id
  botRepo = new DrizzleBotRepo(connection.database)
  bots = new BotService(
    botRepo,
    sessions,
    workspaces,
    new ToolRegistry(),
  )
})

afterEach(async () => {
  close()
  await rm(directory, { recursive: true, force: true })
})

test('initialization migrates saved collaboration tool names once', async () => {
  await bots.initialize()
  const bot = await bots.get('xiaoya')
  await botRepo.save({ ...bot, enabledTools: ['bot.send_message', 'bot.request_task', 'bot.get_task', 'request_task', 'read'] })
  await bots.initialize()
  expect((await bots.get('xiaoya')).enabledTools).toEqual(['send_message', 'request_task', 'get_task', 'read'])
  await bots.initialize()
  expect((await bots.get('xiaoya')).enabledTools).toEqual(['send_message', 'request_task', 'get_task', 'read'])
})

test('seeds once and migrates old conversations without assigning Workspace-based identity to new Bots', async () => {
  await sessions.save({
    id: 'old',
    title: 'Old',
    workspaceId,
    createdAt: 1,
    updatedAt: 1,
    archived: false,
  })
  await bots.initialize()
  await bots.update('xiaoya', { name: '芽芽' })
  await bots.initialize()
  expect(await bots.list()).toHaveLength(2)
  expect((await bots.get('xiaoya')).name).toBe('芽芽')
  expect((await sessions.findById('old'))?.botId).toBe('coder')
  expect((await bots.get('coder')).workspaceIds).toEqual([workspaceId])
  const personal = await bots.create({ name: 'Scout', workspaceIds: [workspaceId] })
  expect(personal.kind).toBe('personal')
  expect(personal.mainThreadId).toBe(`bot:${personal.id}:main`)
  await bots.update(personal.id, { name: 'Researcher' })
  expect((await bots.get(personal.id)).avatar.seed).toBe(personal.id)
})

test('validates defaults and tools, immediately revokes access, preserves built-ins, duplicates independently', async () => {
  await bots.initialize()
  await expect(bots.create({ name: 'Invalid', defaultWorkspaceId: workspaceId })).rejects.toThrow(
    'must be authorized',
  )
  await expect(bots.create({ name: 'Invalid', enabledTools: ['invented'] })).rejects.toThrow(
    'Unknown tool',
  )
  const bot = await bots.create({
    name: 'Scout',
    enabledTools: ['read'],
    workspaceIds: [workspaceId],
    defaultWorkspaceId: workspaceId,
  })
  await expect(bots.assertAccess(bot.id, workspaceId, 'read')).resolves.toMatchObject({
    id: bot.id,
  })
  await bots.update(bot.id, { enabledTools: [] })
  await expect(bots.assertAccess(bot.id, workspaceId, 'read')).rejects.toThrow('not enabled')
  await bots.update(bot.id, { workspaceIds: [], defaultWorkspaceId: null })
  await expect(bots.assertAccess(bot.id, workspaceId)).rejects.toThrow('revoked')
  const copy = await bots.duplicate(bot.id)
  expect(copy.id).not.toBe(bot.id)
  expect(copy.mainThreadId).not.toBe(bot.mainThreadId)
  expect(copy.isBuiltIn).toBe(false)
  await expect(bots.remove('coder')).rejects.toThrow('cannot be deleted')
  await bots.update('coder', { name: 'Dev' })
  expect((await bots.reset('coder')).name).toBe('Coder')
  await bots.remove(bot.id)
  await expect(bots.get(bot.id)).rejects.toThrow('not found')
  expect(await sessions.findAll()).toEqual([])
})


test('updates the untouched built-in Coding prompt and preserves customized instructions', async () => {
  await bots.initialize()
  expect((await bots.get('coder')).instructions).toContain("You are an expert coding assistant operating inside KKlyeeNook's durable agent runtime.")
  await bots.update('coder', { instructions: 'Help with code development, documentation, debugging and tests. Follow the authorized workspace instructions and request approval for side effects when required.' })
  await bots.initialize()
  expect((await bots.get('coder')).instructions).toContain('Use only tools actually provided by the runtime.')
  await bots.update('coder', { instructions: 'Custom coding instructions' })
  await bots.initialize()
  expect((await bots.get('coder')).instructions).toBe('Custom coding instructions')
})
