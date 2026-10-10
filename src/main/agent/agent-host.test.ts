import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Type } from 'typebox'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import type { AgentConfig } from '@/shared/agent/agentConfig'
import { connectDatabase } from '../db/client'
import { DrizzleAgentSessionRepo } from '../db/repositories/agentSessionRepo'
import { DrizzleWorkspaceRepo } from '../db/repositories/workspaceRepo'
import { DrizzleAgentMemoryRepo } from '../db/repositories/memoryRepo'
import { WorkspaceService } from '../workspace/workspaceService'
import { SandboxService } from '../sandbox/sandboxService'
import { ToolRegistry } from '../tools/toolRegistry'
import { MemoryCredentialStore } from '../settings/credentialStore'
import { ContextAttachmentService } from '../context/contextAttachmentService'
import { ContextBuilder } from '../context/contextBuilder'
import { SkillLoader } from '../agent-backend/skillLoader'
import { registerPiBuiltinTools } from './pi/adapters/piBuiltinToolAdapter'
import { AgentHost } from './agent-host'

let directory: string
const hosts: AgentHost[] = []
const databases: Array<() => void> = []
const servers: Server[] = []
const context = () => withAbortSignal(AbortSignal.timeout(20_000), BACKGROUND_CONTEXT)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-host-'))
  await mkdir(join(directory, 'workspace'))
  await writeFile(join(directory, 'workspace', 'AGENTS.md'), 'Actual host workspace instructions')
  await mkdir(join(directory, 'skills', 'review'), { recursive: true })
  await writeFile(
    join(directory, 'skills', 'review', 'SKILL.md'),
    '---\nname: Review\n---\nActual selected skill',
  )
})

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()))
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  for (const close of databases.splice(0)) close()
  await rm(directory, { recursive: true, force: true })
})

async function setup(write = true) {
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push(body)
    const call = write && !body.messages.some((message) => message.role === 'tool')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(
      `data: ${JSON.stringify({
        id: 'local-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'custom-model',
        choices: [
          {
            index: 0,
            delta: call
              ? {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'write-call',
                      type: 'function',
                      function: {
                        name: 'write',
                        arguments: JSON.stringify({
                          path: 'file.txt',
                          content: 'written by durable host',
                        }),
                      },
                    },
                  ],
                }
              : { role: 'assistant', content: 'complete' },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    )
    response.write(
      `data: ${JSON.stringify({ id: 'local-test', object: 'chat.completion.chunk', created: 1, model: 'custom-model', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\n`,
    )
    response.end('data: [DONE]\n\n')
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No HTTP port')
  const database = await connectDatabase(
    'file::memory:',
    fileURLToPath(new URL('../../../drizzle', import.meta.url)),
  )
  databases.push(database.close)
  const sessions = new DrizzleAgentSessionRepo(database.database)
  const workspaces = new WorkspaceService(new DrizzleWorkspaceRepo(database.database))
  const attached = await workspaces.attach(join(directory, 'workspace'))
  const workspaceId = attached.workspace!.id
  const credentials = new MemoryCredentialStore()
  credentials.setApiKey('custom', 'synthetic-key')
  const registry = new ToolRegistry()
  registerPiBuiltinTools(registry, '')
  const attachments = new ContextAttachmentService()
  const memory = new DrizzleAgentMemoryRepo(database.database)
  await memory.create({ scope: 'workspace', workspaceId, content: 'Actual host memory' })
  let config: AgentConfig = {
    model: {
      provider: 'custom',
      modelID: 'custom-model',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: 'openai-completions',
    },
    tools: { enabled: ['read', 'write'] },
    compaction: { enabled: false, reserveTokens: 1000, keepRecentTokens: 1000 },
  }
  const options = {
    databasePath: join(directory, 'durable.sqlite'),
    config: () => config,
    credentials: () => credentials,
    sessions,
    workspaces,
    tools: registry,
    sandbox: new SandboxService({ support: () => 'partial', execute: vi.fn() }),
    retention: { process: async (_run, _call, result) => result },
    contextBuilder: new ContextBuilder(attachments, memory),
    skills: new SkillLoader(join(directory, 'skills')),
  }
  const open = async () => {
    const host = await AgentHost.open(options, BACKGROUND_CONTEXT)
    hosts.push(host)
    return host
  }
  const host = await open()
  return {
    host,
    open,
    options,
    workspaceId,
    sessions,
    workspaces,
    attachments,
    registry,
    requests,
    setConfig: (next: AgentConfig) => {
      config = next
    },
    config,
  }
}

test('one host connects business metadata, model dispatch, instructions, persisted approvals and workspace tools', async () => {
  const { host, options, workspaceId, sessions, attachments, requests } = await setup()
  await host.create({ threadId: 'thread', workspaceId, permissionMode: 'read-only' }, context())
  expect((await sessions.findById('thread'))?.workspaceId).toBe(workspaceId)
  const attachment = attachments.stage({
    name: 'attached.txt',
    mimeType: 'text/plain',
    size: 20,
    text: 'Actual host attached context',
  })
  const accepted = await host.conversations.submit(
    'thread',
    {
      type: 'input',
      content: 'write file',
      requestId: 'request',
      contextAttachmentIds: [attachment.id],
      skillIds: ['review'],
    },
    context(),
  )
  await vi.waitFor(
    async () =>
      expect(await host.tools.approvals.pending(accepted.conversationId, context())).toHaveLength(
        1,
      ),
    { timeout: 15_000 },
  )
  const [approval] = await host.tools.approvals.pending(accepted.conversationId, context())
  const prompt = JSON.stringify(requests[0])
  expect(prompt).toContain('Actual host workspace instructions')
  expect(prompt).toContain('Actual host memory')
  expect(prompt).toContain('Actual host attached context')
  expect(prompt).toContain('Actual selected skill')
  await expect(AgentHost.open(options, context())).rejects.toThrow('locked')
  await host.tools.approvals.decide(accepted.conversationId, approval.id, 'approved', context())
  const submission = await host.engine.submission('thread', accepted.submissionId, context())
  expect((await submission.wait(context())).status).toBe('done')
  await (await host.engine.conversation('thread', context())).waitForIdle(context())
  expect(await readFile(join(directory, 'workspace', 'file.txt'), 'utf8')).toBe(
    'written by durable host',
  )
  expect(requests).toHaveLength(2)
}, 30_000)

test('host recovery reconnects approval and context services before resuming unfinished work', async () => {
  const { host, open, workspaceId, attachments, requests } = await setup()
  await host.create({ threadId: 'thread', workspaceId, permissionMode: 'read-only' }, context())
  const accepted = await host.conversations.submit(
    'thread',
    { type: 'input', content: 'write', requestId: 'request' },
    context(),
  )
  await vi.waitFor(
    async () =>
      expect(await host.tools.approvals.pending(accepted.conversationId, context())).toHaveLength(
        1,
      ),
    { timeout: 15_000 },
  )
  const [approval] = await host.tools.approvals.pending(accepted.conversationId, context())
  await host.close()
  attachments.clear()
  const restored = await open()
  expect(await restored.tools.approvals.pending(accepted.conversationId, context())).toEqual([
    approval,
  ])
  await restored.tools.approvals.decide(accepted.conversationId, approval.id, 'approved', context())
  expect(
    (
      await (
        await restored.engine.submission('thread', accepted.submissionId, context())
      ).wait(context())
    ).status,
  ).toBe('done')
  await (await restored.engine.conversation('thread', context())).waitForIdle(context())
  expect(requests).toHaveLength(2)
  expect(await readFile(join(directory, 'workspace', 'file.txt'), 'utf8')).toBe(
    'written by durable host',
  )
}, 30_000)

test('workspace detachment during approval cannot authorize a later write', async () => {
  const { host, workspaceId, workspaces } = await setup()
  await host.create({ threadId: 'thread', workspaceId, permissionMode: 'read-only' }, context())
  const accepted = await host.conversations.submit(
    'thread',
    { type: 'input', content: 'write', requestId: 'request' },
    context(),
  )
  await vi.waitFor(
    async () =>
      expect(await host.tools.approvals.pending(accepted.conversationId, context())).toHaveLength(
        1,
      ),
    { timeout: 15_000 },
  )
  const [approval] = await host.tools.approvals.pending(accepted.conversationId, context())
  await workspaces.detach(workspaceId)
  await host.tools.approvals.decide(accepted.conversationId, approval.id, 'approved', context())
  await (await host.engine.submission('thread', accepted.submissionId, context())).wait(context())
  await (await host.engine.conversation('thread', context())).waitForIdle(context())
  await expect(readFile(join(directory, 'workspace', 'file.txt'))).rejects.toThrow()
  expect(JSON.stringify(await host.conversations.snapshot('thread', context()))).toContain(
    'PERMISSION_DENIED',
  )
}, 30_000)

test('personal identity stays separate and registry refresh changes only the durable tool selection', async () => {
  const { host, registry, config, setConfig } = await setup(false)
  await host.create({ threadId: 'personal' }, context())
  const accepted = await host.conversations.submit(
    'personal',
    { type: 'input', content: 'hello', requestId: 'request' },
    context(),
  )
  await (await host.engine.submission('personal', accepted.submissionId, context())).wait(context())
  const conversation = await host.engine.conversation('personal', context())
  await conversation.waitForIdle(context())
  const snapshot = await host.conversations.snapshot('personal', context())
  expect(JSON.stringify(snapshot.entries)).toContain('KKlyeeNook personal assistant')
  expect(JSON.stringify(snapshot.entries)).not.toContain('Actual host workspace instructions')
  const unregister = registry.register({
    definition: {
      name: 'mcp__server__fetch',
      label: 'Fetch',
      description: 'Fetch',
      inputSchema: Type.Object({}),
      origin: { kind: 'mcp', serverId: 'server', serverName: 'Server', remoteName: 'fetch' },
    },
    adapter: { runtime: 'pi', create: () => ({ execute: async () => ({ content: [] }) }) },
  })
  await host.refreshTools(context())
  expect((await conversation.agent(context())).tools.map((tool) => tool.name)).toContain(
    'mcp__server__fetch',
  )
  unregister()
  await host.refreshTools(context())
  expect((await conversation.agent(context())).tools.map((tool) => tool.name)).not.toContain(
    'mcp__server__fetch',
  )
  setConfig({ ...config, tools: { enabled: ['read'] } })
  await host.reload(context())
  expect((await conversation.agent(context())).tools.map((tool) => tool.name)).toEqual(['read'])
}, 30_000)
