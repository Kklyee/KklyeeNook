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
import { startDurableHttpServer } from '../agent-backend/durable-http'
import type { RunningAgentHttpServer } from '../agent-backend/http-server'
import type { DurableFrame } from '@/shared/agent/durable-protocol'

let directory: string
const hosts: AgentHost[] = []
const databases: Array<() => void> = []
const servers: Server[] = []
const httpServers: RunningAgentHttpServer[] = []
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
  await Promise.all(httpServers.splice(0).map((server) => server.close()))
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

type Reply = string | { name: string; arguments: Record<string, unknown>; id?: string }

async function setup(write = true, respond?: (body: Record<string, any>) => Reply) {
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push(body)
    const reply =
      respond?.(body) ??
      (write && !body.messages.some((message) => message.role === 'tool')
        ? { name: 'write', arguments: { path: 'file.txt', content: 'written by durable host' } }
        : 'complete')
    const call = typeof reply !== 'string'
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
                      id: reply.id ?? 'write-call',
                      type: 'function',
                      function: { name: reply.name, arguments: JSON.stringify(reply.arguments) },
                    },
                  ],
                }
              : { role: 'assistant', content: reply },
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

async function api(host: AgentHost) {
  const server = await startDurableHttpServer(host, {
    secret: 'test-secret',
    allowedOrigins: ['http://allowed.test'],
  })
  httpServers.push(server)
  return {
    baseUrl: server.baseUrl,
    request: (path: string, method = 'GET', body?: unknown, origin?: string) =>
      fetch(server.baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  }
}

async function events(baseUrl: string, threadId: string) {
  const controller = new AbortController()
  const response = await fetch(`${baseUrl}/threads/${threadId}/events`, {
    signal: controller.signal,
  })
  expect(response.status).toBe(200)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  return {
    stop: () => controller.abort(),
    next: async (): Promise<DurableFrame> => {
      while (true) {
        const end = buffer.indexOf('\n\n')
        if (end >= 0) {
          const lines = buffer.slice(0, end).split('\n')
          buffer = buffer.slice(end + 2)
          const data = lines
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))
            .join('\n')
          if (data) return JSON.parse(data)
        } else {
          const chunk = await reader.read()
          if (chunk.done) throw new Error('Event stream ended')
          buffer += decoder.decode(chunk.value, { stream: true })
        }
      }
    },
  }
}

test('durable HTTP keeps authentication, rejects passive writes and preserves scoped idempotency', async () => {
  const { host, workspaceId, requests } = await setup()
  const { baseUrl, request } = await api(host)
  expect((await fetch(baseUrl.replace('test-secret', 'incorrect') + '/threads')).status).toBe(404)
  expect((await request('/threads', 'GET', undefined, 'http://untrusted.test')).status).toBe(403)
  const allowed = await request('/threads', 'GET', undefined, 'http://allowed.test')
  expect(allowed.headers.get('access-control-allow-origin')).toBe('http://allowed.test')
  expect(
    (
      await request('/threads', 'POST', {
        threadId: 'thread',
        workspaceId,
        permissionMode: 'read-only',
      })
    ).status,
  ).toBe(201)
  expect((await request('/threads', 'POST', { threadId: 'other' })).status).toBe(201)
  expect(
    (
      await request('/threads/thread/submissions', 'POST', {
        type: 'write',
        requestId: 'illegal',
        entry: { kind: 'pi.user' },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await request('/threads/thread/submissions', 'POST', {
        type: 'input',
        requestId: 'illegal',
        content: 'text',
        entry: {},
      })
    ).status,
  ).toBe(400)
  expect(
    (await request('/threads/thread/submissions', 'POST', { type: 'input', content: 'no id' }))
      .status,
  ).toBe(400)
  expect(requests).toHaveLength(0)
  const draft = { type: 'input', requestId: 'request', content: 'write' }
  const accepted = await (await request('/threads/thread/submissions', 'POST', draft)).json()
  const retry = await (
    await request('/threads/thread/submissions', 'POST', {
      ...draft,
      content: 'replacement must not win',
    })
  ).json()
  expect(retry).toEqual(accepted)
  await vi.waitFor(
    async () => expect(await (await request('/threads/thread/approvals')).json()).toHaveLength(1),
    { timeout: 15_000 },
  )
  const [approval] = await (await request('/threads/thread/approvals')).json()
  expect(
    (await request(`/threads/other/approvals/${approval.id}`, 'POST', { state: 'approved' }))
      .status,
  ).toBe(404)
  expect((await request(`/threads/other/submissions/${accepted.submissionId}`)).status).toBe(404)
  expect(
    (await request(`/threads/thread/approvals/${approval.id}`, 'POST', { state: 'approved' }))
      .status,
  ).toBe(200)
  expect(
    (await request(`/threads/thread/approvals/${approval.id}`, 'POST', { state: 'rejected' }))
      .status,
  ).toBe(409)
  await (await host.engine.submission('thread', accepted.submissionId, context())).wait(context())
  expect((await request(`/threads/thread/submissions/${accepted.submissionId}`)).status).toBe(200)
  expect(JSON.stringify(await (await request('/threads/thread')).json())).not.toContain(
    'replacement must not win',
  )
  expect(await readFile(join(directory, 'workspace', 'file.txt'), 'utf8')).toBe(
    'written by durable host',
  )
}, 30_000)

test('HTTP withdraw and cancel use official submissions and stale approval decisions are rejected', async () => {
  const { host, workspaceId } = await setup()
  const { request } = await api(host)
  await host.create({ threadId: 'thread', workspaceId, permissionMode: 'read-only' }, context())
  await request('/threads/thread/submissions', 'POST', {
    type: 'input',
    requestId: 'first',
    content: 'write',
  })
  await vi.waitFor(
    async () => expect(await (await request('/threads/thread/approvals')).json()).toHaveLength(1),
    { timeout: 15_000 },
  )
  const [approval] = await (await request('/threads/thread/approvals')).json()
  const queued = await (
    await request('/threads/thread/submissions', 'POST', {
      type: 'input',
      requestId: 'queued',
      content: 'queued',
      whenBusy: 'followUp',
    })
  ).json()
  expect((await (await request('/threads/thread')).json()).queue).toEqual([
    { id: queued.submissionId, mode: 'followUp', content: 'queued' },
  ])
  expect(
    await (await request(`/threads/thread/submissions/${queued.submissionId}`, 'DELETE')).json(),
  ).toEqual({ status: 'aborted' })
  expect((await request('/threads/thread/cancel', 'POST')).status).toBe(204)
  expect(await (await request('/threads/thread/approvals')).json()).toEqual([])
  expect(
    (await request(`/threads/thread/approvals/${approval.id}`, 'POST', { state: 'approved' }))
      .status,
  ).toBe(409)
  expect(
    (await (await request(`/threads/thread/submissions/${queued.submissionId}`)).json()).status,
  ).toBe('unanswered')
  await expect(readFile(join(directory, 'workspace', 'file.txt'))).rejects.toThrow()
}, 30_000)

test('SSE frames reset on reconnect, preserve order and do not own execution lifetime', async () => {
  const { host, workspaceId } = await setup()
  const { baseUrl, request } = await api(host)
  await host.create({ threadId: 'thread', workspaceId, permissionMode: 'read-only' }, context())
  const first = await events(baseUrl, 'thread')
  const initial = await first.next()
  expect(initial.type).toBe('reset')
  expect(initial.sequence).toBe(0)
  expect(initial.events[0].type).toBe('snapshot')
  const accepted = await (
    await request('/threads/thread/submissions', 'POST', {
      type: 'input',
      requestId: 'request',
      content: 'write',
    })
  ).json()
  let current = initial
  while (!current.approvals.length) {
    const next = await first.next()
    expect(next.epoch).toBe(initial.epoch)
    expect(next.sequence).toBe(current.sequence + 1)
    current = next
  }
  const approval = current.approvals[0]
  first.stop()
  const second = await events(baseUrl, 'thread')
  const reset = await second.next()
  expect(reset.type).toBe('reset')
  expect(reset.sequence).toBe(0)
  expect(reset.epoch).not.toBe(initial.epoch)
  expect(reset.approvals[0].id).toBe(approval.id)
  expect((await host.conversations.status('thread', accepted.submissionId, context())).status).toBe(
    'placed',
  )
  await request(`/threads/thread/approvals/${approval.id}`, 'POST', { state: 'approved' })
  await (await host.engine.submission('thread', accepted.submissionId, context())).wait(context())
  expect(await readFile(join(directory, 'workspace', 'file.txt'), 'utf8')).toBe(
    'written by durable host',
  )
  second.stop()
}, 30_000)

function delegateReply(body: Record<string, any>): Reply {
  const user = body.messages.filter((message) => message.role === 'user').at(-1)?.content
  if (body.messages.some((message) => message.role === 'tool')) return 'complete'
  return JSON.stringify(user).includes('root-secret')
    ? {
        name: 'delegate_task',
        arguments: { task: 'child task', context: 'explicit context only', skillIds: ['review'] },
      }
    : { name: 'write', arguments: { path: 'file.txt', content: 'child wrote safely' } }
}

test('durable delegation inherits permissions, isolates history and resumes the same child after restart', async () => {
  const { host, open, workspaceId, config, setConfig, requests, options } = await setup(
    false,
    delegateReply,
  )
  setConfig({ ...config, tools: { enabled: ['delegate_task', 'write'] } })
  await host.reload(context())
  const finish = vi.spyOn(options.sandbox, 'finishRun')
  await host.create({ threadId: 'thread', workspaceId, permissionMode: 'read-only' }, context())
  const accepted = await host.conversations.submit(
    'thread',
    { type: 'input', requestId: 'root', content: 'root-secret must not leak into child' },
    context(),
  )
  let childId
  await vi.waitFor(
    async () => {
      const inspection = await host.engine.harness.inspect(context())
      childId = inspection.tasks
        .map(({ record }) => record.conversationId)
        .find((id) => id !== accepted.conversationId)
      expect(
        childId,
        JSON.stringify(await host.conversations.snapshot('thread', context())),
      ).toBeDefined()
      expect(await host.tools.approvals.pending(childId, context())).toHaveLength(1)
    },
    { timeout: 15_000 },
  )
  const [approval] = await host.tools.approvals.pending(childId, context())
  expect((await host.engine.ownerThread(childId, context())).threadId).toBe('thread')
  expect(JSON.stringify(requests[1])).not.toContain('root-secret')
  expect(JSON.stringify(requests[1])).toContain('explicit context only')
  expect(JSON.stringify(requests[1])).toContain('Actual selected skill')
  await host.close()
  await rm(join(directory, 'skills'), { recursive: true })
  const restored = await open()
  expect(await restored.tools.approvals.pending(childId, context())).toEqual([approval])
  await restored.tools.approvals.decide(childId, approval.id, 'approved', context())
  await (
    await restored.engine.submission('thread', accepted.submissionId, context())
  ).wait(context())
  await (await restored.engine.conversation('thread', context())).waitForIdle(context())
  expect(await readFile(join(directory, 'workspace', 'file.txt'), 'utf8')).toBe(
    'child wrote safely',
  )
  expect(requests).toHaveLength(4)
  await vi.waitFor(() =>
    expect(finish).toHaveBeenCalledWith(
      `durable:${accepted.conversationId}:${accepted.submissionId}`,
    ),
  )
}, 30_000)

test('aborting a parent drains owned child work and invalidates its approvals', async () => {
  const { host, workspaceId, config, setConfig } = await setup(false, delegateReply)
  setConfig({ ...config, tools: { enabled: ['delegate_task', 'write'] } })
  await host.reload(context())
  await host.create({ threadId: 'thread', workspaceId, permissionMode: 'read-only' }, context())
  const accepted = await host.conversations.submit(
    'thread',
    { type: 'input', requestId: 'root', content: 'root-secret' },
    context(),
  )
  let approval
  let childId
  await vi.waitFor(
    async () => {
      childId = (await host.engine.harness.inspect(context())).tasks
        .map(({ record }) => record.conversationId)
        .find((id) => id !== accepted.conversationId)
      expect(childId).toBeDefined()
      ;[approval] = await host.tools.approvals.pending(childId, context())
      expect(approval).toBeDefined()
    },
    { timeout: 15_000 },
  )
  await host.conversations.cancel('thread', context())
  expect((await host.engine.harness.inspect(context())).tasks).toEqual([])
  expect(await host.tools.approvals.pending(childId, context())).toEqual([])
  await expect(
    host.tools.approvals.decide(childId, approval.id, 'approved', context()),
  ).rejects.toThrow('no longer active')
  await expect(readFile(join(directory, 'workspace', 'file.txt'))).rejects.toThrow()
}, 30_000)
