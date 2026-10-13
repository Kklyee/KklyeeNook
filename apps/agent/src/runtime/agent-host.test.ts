import { createServer, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Type } from 'typebox'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import type { AgentConfig } from '@kklyeenook/shared/agent/agentConfig'
import { connectDatabase } from '../db/client'
import { DrizzleAgentSessionRepo } from '../db/repositories/agent-session-repo'
import { DrizzleBotRepo } from '../db/repositories/bot-repo'
import { DrizzleGroveRepo } from '../db/repositories/grove-repo'
import { DrizzleWorkspaceRepo } from '../db/repositories/workspaceRepo'
import { DrizzleAgentMemoryRepo } from '../db/repositories/memoryRepo'
import { WorkspaceService } from '../workspace/workspaceService'
import { SandboxService } from '../sandbox/sandbox-service'
import { ToolRegistry } from '../tools/toolRegistry'
import { MemoryCredentialStore } from '../settings/credentialStore'
import { ContextAttachmentService } from '../context/contextAttachmentService'
import { ContextBuilder } from '../context/contextBuilder'
import { SkillLoader } from '../backend/skillLoader'
import { registerBuiltinTools } from '../tools/builtin-tools'
import { AgentHost } from './agent-host'
import { AgentScheduler } from '../scheduler/agent-scheduler'
import type { ScheduledTask } from '@kklyeenook/shared/scheduler/scheduled-task'
import { RunProjection } from './run-projection'
import { startAgentHttpServer } from '../backend/agent-http'
import type { RunningAgentHttpServer } from '../backend/http-server'
import type { AgentFrame } from '@kklyeenook/shared/agent/chat-protocol'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { createRemoteAgentPort } from '../remote/remote-agent-port'
import { startRemoteGateway } from '../remote/remote-gateway'
import { AgentConfigStore } from '../settings/agentConfigStore'
import { inputDoc } from './inputs'
import { verifyRemote, verifyRemoteMobile } from '../backend/testing/remote-browser'

let directory: string
const hosts: AgentHost[] = []
const databases: Array<() => void> = []
const servers: Server[] = []
const httpServers: RunningAgentHttpServer[] = []
const context = () => withAbortSignal(AbortSignal.timeout(20_000), BACKGROUND_CONTEXT)

test('mentions persist references without dispatching work and preserve coordination tools across restart', async () => {
  const fixture = await setup(false, undefined, undefined, true)
  let host = fixture.host
  const source = await host.mainThread('xiaoya', context())
  expect(host.tools.extensions().find((extension) => extension.name === 'bot')?.tools?.map((tool) => tool.name)).toEqual(['bot_list', 'bot_get_status', 'bot_list_tasks', 'bot_send_message', 'bot_request_task', 'bot_get_task'])
  const input = { type: 'input' as const, requestId: 'mention-message', content: '@Coder now busy?', botMentions: [{ botId: 'coder', displayName: 'Coder', start: 0, end: 6 }] }
  const receipt = await host.conversations.submit(source.id, input, context())
  expect((await host.conversations.submit(source.id, input, context())).submissionId).toBe(receipt.submissionId)
  const conversation = await host.engine.conversation(source.id, context())
  const prepared = await host.engine.harness.snapshot(inputDoc, conversation.id, input.requestId, context())
  expect(prepared?.bot?.tools).toContain('bot_request_task')
  expect((await host.grove!.list(context())).tasks).toEqual([])
  await vi.waitFor(async () => expect((await host.conversations.snapshot(source.id, context())).entries.some((entry) => entry.kind === 'nook.mentions')).toBe(true))
  await vi.waitFor(() => expect(fixture.requests).toHaveLength(1))
  await host.close()
  hosts.splice(hosts.indexOf(host), 1)
  host = await fixture.open()
  expect((await host.conversations.submit(source.id, input, context())).submissionId).toBe(receipt.submissionId)
  expect((await host.grove!.list(context())).tasks).toEqual([])
}, 30000)

test('concurrent mention messages cannot reuse one ID with different content', async () => {
  const { host } = await setup(false, undefined, undefined, true)
  const source = await host.mainThread('xiaoya', context())
  const input = { type: 'input' as const, requestId: 'concurrent-mentions', content: '@Coder first', botMentions: [{ botId: 'coder', displayName: 'Coder', start: 0, end: 6 }] }
  const results = await Promise.allSettled([
    host.conversations.submit(source.id, input, context()),
    host.conversations.submit(source.id, { ...input, content: '@Coder second' }, context()),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { message: 'Message ID already used with different mention content' } })
  expect((await host.grove!.list(context())).tasks).toHaveLength(0)
})

test('mentions allow references when task reception is disabled and reject invalid ranges', async () => {
  const { host, requests } = await setup(false, undefined, undefined, true)
  const source = await host.mainThread('xiaoya', context())
  const input = { type: 'input' as const, requestId: 'blocked-mention', content: '@Coder review', botMentions: [{ botId: 'coder', displayName: 'Coder', start: 0, end: 6 }] }
  await host.grove!.setPolicy('coder', { messages: true, tasks: false, allowedBotIds: null }, context())
  await host.conversations.submit(source.id, input, context())
  expect(requests).toHaveLength(0)
  expect((await host.grove!.list(context())).tasks).toEqual([])
  await expect(host.conversations.submit(source.id, { ...input, botMentions: [{ ...input.botMentions[0], end: 5 }] }, context())).rejects.toThrow('structured')
})

test('multiple mentions remain references and enforce the three-token limit', async () => {
  const { host } = await setup(false, undefined, undefined, true)
  const helper = await host.bots!.create({ name: 'Designer' })
  const source = await host.mainThread('xiaoya', context())
  const input = { type: 'input' as const, requestId: 'multiple-mentions', content: '@Coder @Designer @Coder review', botMentions: [
    { botId: 'coder', displayName: 'Coder', start: 0, end: 6 },
    { botId: helper.id, displayName: 'Designer', start: 7, end: 16 },
    { botId: 'coder', displayName: 'Coder', start: 17, end: 23 },
  ] }
  await host.conversations.submit(source.id, input, context())
  expect((await host.grove!.list(context())).tasks).toHaveLength(0)
  await expect(host.conversations.submit(source.id, { ...input, requestId: 'over-limit', botMentions: [...input.botMentions, input.botMentions[2]] }, context())).rejects.toThrow('3')
  expect((await host.grove!.list(context())).tasks).toHaveLength(0)
})

test('Grove records ordinary messages without running models and rejects impersonation input', async () => {
  const { host, requests } = await setup(false, undefined, undefined, true)
  const source = await host.mainThread('xiaoya', context())
  const caller = { threadId: source.id }
  const input = { toBotId: 'coder', content: 'Hello Coder', operationId: 'message-1' }
  const message = await host.grove!.sendMessage(caller, input, context())
  expect(await host.grove!.sendMessage(caller, input, context())).toEqual(message)
  expect(message.fromBotId).toBe('xiaoya')
  expect((await host.grove!.list(context())).messages).toHaveLength(1)
  expect(requests).toHaveLength(0)
  await expect(host.grove!.sendMessage(caller, { ...input, content: 'changed' }, context())).rejects.toThrow('different input')
  await host.grove!.setPolicy('coder', { messages: false, tasks: false, allowedBotIds: null }, context())
  await expect(host.grove!.sendMessage(caller, { ...input, operationId: 'message-2' }, context())).rejects.toThrow('reception policy')
  const server = await startAgentHttpServer(host)
  httpServers.push(server)
  const response = await fetch(`${server.baseUrl}/grove/tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId: source.id, fromBotId: 'coder', toBotId: 'xiaoya', instruction: 'spoof', operationId: 'spoof' }),
  })
  expect(response.status).toBe(400)
})

test('Grove executes with target Bot configuration and returns a correlated result exactly once across restart', async () => {
  const fixture = await setup(false, (body) => body.messages.some((message) => message.content?.includes?.('TARGET_ONLY')) ? 'Coder independent result' : 'Summary for user', undefined, true)
  let host = fixture.host
  fixture.setConfig({ ...fixture.config, models: [
    { ...fixture.config.model, id: 'custom:custom-model' },
    { ...fixture.config.model, id: 'custom:coder-model', modelID: 'coder-model' },
  ] })
  await host.reload(context())
  await host.bots!.update('coder', { instructions: 'TARGET_ONLY', model: { provider: 'custom', modelId: 'coder-model' }, workspaceIds: [fixture.workspaceId], defaultWorkspaceId: fixture.workspaceId })
  const source = await host.mainThread('xiaoya', context())
  const caller = { threadId: source.id }
  const input = { toBotId: 'coder', instruction: 'Review the project', operationId: 'task-1' }
  const task = await host.grove!.requestTask(caller, input, context())
  await vi.waitFor(async () => expect((await host.grove!.getTask(caller, task.id, context())).status).toBe('completed'), { timeout: 15000 })
  const finished = await host.grove!.getTask(caller, task.id, context())
  expect(finished.result).toBe('Coder independent result')
  expect(fixture.requests.some((request) => request.model === 'coder-model')).toBe(true)
  expect(finished.targetThreadId).toBe(`collaboration:${task.id}`)
  const target = await host.conversations.get(finished.targetThreadId!, context())
  expect(target.workspaceId).toBe(fixture.workspaceId)
  expect((await host.conversations.get(source.id, context())).workspaceId).toBeNull()
  expect((await host.conversations.snapshot(source.id, context())).entries).toHaveLength(0)
  await host.close()
  hosts.splice(hosts.indexOf(host), 1)
  host = await fixture.open()
  const retried = await host.grove!.requestTask(caller, input, context())
  expect(retried.submissionId).toBe(finished.submissionId)
  const state = await host.grove!.list(context())
  expect(state.tasks).toHaveLength(1)
  expect(state.messages.filter((message) => message.type === 'result' && message.correlationId === task.id)).toHaveLength(1)
  const other = await host.bots!.create({ name: 'Other' })
  const otherThread = await host.mainThread(other.id, context())
  await expect(host.grove!.getTask({ threadId: otherThread.id }, task.id, context())).rejects.toThrow('other Bots')
  await expect(host.grove!.requestTask(caller, { ...input, toBotId: 'xiaoya', operationId: 'self' }, context())).rejects.toThrow('itself')
  await expect(host.grove!.requestTask({ threadId: target.id, parentTaskId: task.id }, { ...input, toBotId: 'xiaoya', operationId: 'cycle' }, context())).rejects.toThrow('cycle')
}, 30_000)

test('Grove tools use caller identity through the existing execution harness and summarize the independent result', async () => {
  const fixture = await setup(false, (body) => {
    const system = body.messages.filter((message) => message.role === 'system').map((message) => message.content).join('')
    if (system.includes('TARGET_TOOL_TEST')) return 'Independent tool result'
    if (body.messages.some((message) => JSON.stringify(message.content).includes('Collaboration ') && JSON.stringify(message.content).includes('Summarize this result'))) return 'Final collaboration summary'
    if (body.messages.some((message) => message.role === 'tool')) return 'Final collaboration summary'
    return { name: 'bot_request_task', arguments: { botId: 'coder', instruction: 'Review independently' } }
  }, undefined, true)
  await fixture.host.bots!.update('coder', { instructions: 'TARGET_TOOL_TEST' })
  const source = await fixture.host.mainThread('xiaoya', context())
  await fixture.host.conversations.submit(source.id, { type: 'input', requestId: 'grove-tool-test', content: 'Ask Coder for review' }, context())
  await vi.waitFor(async () => {
    const tasks = (await fixture.host.grove!.list(context())).tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ fromBotId: 'xiaoya', toBotId: 'coder', status: 'completed', result: 'Independent tool result' })
    const snapshot = await fixture.host.conversations.snapshot(source.id, context())
    expect(JSON.stringify(snapshot)).toContain('Final collaboration summary')
    expect(snapshot.entries.flatMap((entry) => entry.model ?? []).filter((message) => message.role === 'user')).toHaveLength(1)
  }, { timeout: 15000 })
}, 25_000)

test('Grove restores queued work without duplicate submissions and rechecks revoked reception policy', async () => {
  const fixture = await setup(false, undefined, undefined, true)
  let host = fixture.host
  const source = await host.mainThread('xiaoya', context())
  const caller = { threadId: source.id }
  const first = await host.grove!.requestTask(caller, { toBotId: 'coder', instruction: 'Queued review', operationId: 'queued-1' }, context())
  const second = await host.grove!.requestTask(caller, { toBotId: 'coder', instruction: 'Blocked review', operationId: 'queued-2' }, context())
  await host.close()
  hosts.splice(hosts.indexOf(host), 1)
  host = await fixture.open()
  await vi.waitFor(async () => expect((await host.grove!.getTask(caller, first.id, context())).status).toBe('completed'), { timeout: 15000 })
  const tasks = (await host.grove!.list(context())).tasks
  expect(tasks).toHaveLength(2)
  expect(tasks.find((task) => task.id === first.id)?.submissionId).not.toBe(tasks.find((task) => task.id === second.id)?.submissionId)
  await host.close()
  hosts.splice(hosts.indexOf(host), 1)
  let blockedId = ''
  host = await fixture.open(async (initializing) => {
    const blocked = await initializing.grove!.requestTask(caller, { toBotId: 'coder', instruction: 'Policy revoked', operationId: 'queued-3' }, context())
    blockedId = blocked.id
    await initializing.grove!.setPolicy('coder', { messages: true, tasks: false, allowedBotIds: null }, context())
  })
  await vi.waitFor(async () => expect((await host.grove!.getTask(caller, blockedId, context())).status).toBe('failed'), { timeout: 15000 })
  expect((await host.grove!.getTask(caller, blockedId, context())).submissionId).toBeUndefined()
}, 30_000)

test('Grove enforces a persistent generation budget and reception checks before side effects', async () => {
  const fixture = await setup(false, undefined, undefined, true)
  const source = await fixture.host.mainThread('xiaoya', context())
  const caller = { threadId: source.id }
  const task = await fixture.host.grove!.requestTask(caller, { toBotId: 'coder', instruction: 'Review', operationId: 'budget' }, context())
  for (let generation = 1000; generation < 1024; generation++) await fixture.host.grove!.guardGeneration(task.id, generation, true, context())
  await expect(fixture.host.grove!.guardGeneration(task.id, 1024, true, context())).rejects.toThrow('model budget')
  await fixture.host.grove!.guardGeneration(task.id, 1000, true, context())
  await fixture.host.grove!.setPolicy('coder', { messages: true, tasks: false, allowedBotIds: null }, context())
  await expect(fixture.host.grove!.guardExecution(task.id, context())).rejects.toThrow('reception policy')
})

test('Grove persists an explicit failure when a target returns no valid answer', async () => {
  const { host } = await setup(false, () => '', undefined, true)
  const source = await host.mainThread('xiaoya', context())
  const caller = { threadId: source.id }
  const task = await host.grove!.requestTask(caller, { toBotId: 'coder', instruction: 'Review', operationId: 'empty-answer' }, context())
  await vi.waitFor(async () => expect(await host.grove!.getTask(caller, task.id, context())).toMatchObject({ status: 'failed', result: 'Bot did not return a valid answer' }), { timeout: 15000 })
}, 20_000)

test('activity queries aggregate workspace threads and future schedules without waking a Bot', async () => {
  const { host, requests, workspaceId } = await setup(false, undefined, undefined, true)
  await host.bots!.update('coder', { workspaceIds: [workspaceId] })
  await host.mainThread('coder', context())
  await host.create({ threadId: 'coder-workspace', botId: 'coder', workspaceId }, context())
  host.scheduledTasks = async () => [{ id: 'future', title: 'Later', prompt: 'Work', botId: 'coder', schedule: { type: 'once', runAt: Date.now() + 60000 }, enabled: true, createdAt: Date.now(), updatedAt: Date.now() }]
  const status = await host.activity.getStatus('coder', context())
  expect(status).toMatchObject({ state: 'idle', runningCount: 0, queuedCount: 0, pendingApprovalCount: 0 })
  expect(status.tasks).toContainEqual(expect.objectContaining({ kind: 'scheduled', status: 'scheduled' }))
  expect(requests).toHaveLength(0)
})

test('a structured mention lets the coordinator query status without invoking the target model', async () => {
  const fixture = await setup(false, (body) => body.messages.some((message) => message.role === 'tool')
    ? 'Coder is idle'
    : { name: 'bot_get_status', arguments: { botId: 'coder' } }, undefined, true)
  await fixture.host.bots!.update('coder', { instructions: 'TARGET_MUST_NOT_WAKE' })
  const source = await fixture.host.mainThread('xiaoya', context())
  await fixture.host.conversations.submit(source.id, { type: 'input', requestId: 'status-query', content: '@Coder busy?', botMentions: [{ botId: 'coder', displayName: 'Coder', start: 0, end: 6 }] }, context())
  await vi.waitFor(async () => expect(JSON.stringify(await fixture.host.conversations.snapshot(source.id, context()))).toContain('Coder is idle'))
  expect(fixture.requests).toHaveLength(2)
  expect(JSON.stringify(fixture.requests)).not.toContain('TARGET_MUST_NOT_WAKE')
  expect(JSON.stringify(fixture.requests[0])).toContain('Coding Agent')
  expect((await fixture.host.grove!.list(context())).tasks).toEqual([])
})

test('async coordination stays attached to its tool call without injecting a later message', async () => {
  const fixture = await setup(false, (body) => {
    if (body.messages.some((message) => message.role === 'system' && message.content.includes('ASYNC_TARGET'))) return 'Async result'
    if (body.messages.some((message) => message.role === 'tool')) return 'Task submitted'
    return { name: 'bot_request_task', arguments: { botId: 'coder', instruction: 'Review', mode: 'async' } }
  }, undefined, true)
  await fixture.host.bots!.update('coder', { instructions: 'ASYNC_TARGET' })
  const source = await fixture.host.mainThread('xiaoya', context())
  await fixture.host.conversations.submit(source.id, { type: 'input', requestId: 'async', content: 'Delegate' }, context())
  await vi.waitFor(async () => expect((await fixture.host.grove!.list(context())).tasks[0]).toMatchObject({ status: 'completed', sourceToolCallId: 'write-call', mode: 'async' }), { timeout: 15000 })
  const snapshot = await fixture.host.conversations.snapshot(source.id, context())
  expect(snapshot.entries.flatMap((entry) => entry.model ?? []).filter((message) => message.role === 'user')).toHaveLength(1)
  expect(JSON.stringify(snapshot)).toContain('Task submitted')
  expect(fixture.requests).toHaveLength(3)
})

test('collaborations serialize one workspace while independent main conversations remain usable', async () => {
  const { host, workspaceId } = await setup(false, undefined, undefined, true)
  await host.bots!.update('coder', { workspaceIds: [workspaceId], defaultWorkspaceId: workspaceId })
  const source = await host.mainThread('xiaoya', context())
  const caller = { threadId: source.id }
  const first = await host.grove!.requestTask(caller, { toBotId: 'coder', instruction: 'First', operationId: 'serial-first', mode: 'async' }, context())
  const second = await host.grove!.requestTask(caller, { toBotId: 'coder', instruction: 'Second', operationId: 'serial-second', mode: 'async' }, context())
  await vi.waitFor(async () => {
    const tasks = (await host.grove!.list(context())).tasks
    if (tasks.find((task) => task.id === first.id)?.status !== 'completed') expect(tasks.find((task) => task.id === second.id)?.submissionId).toBeUndefined()
    expect(tasks.find((task) => task.id === second.id)?.status).toBe('completed')
  }, { timeout: 15000 })
  const target = await host.grove!.getTask(caller, first.id, context())
  expect((await host.conversations.get(target.targetThreadId!, context())).workspaceId).toBe(workspaceId)
  expect((await host.conversations.snapshot((await host.mainThread('coder', context())).id, context())).entries).toHaveLength(0)
  await expect(host.grove!.requestTask({ threadId: target.targetThreadId! }, { toBotId: 'xiaoya', instruction: 'No inherited access', workspaceId, operationId: 'ungranted', mode: 'async' }, context())).rejects.toThrow('Workspace access')
})

test('workspace tool leases serialize writers across ordinary conversations and release after completion', async () => {
  const fixture = await setup(false, (body) => body.messages.some((message) => message.role === 'tool') ? 'Done' : { name: 'workspace_probe', arguments: {} }, undefined, true)
  let active = 0
  let maximum = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  fixture.registry.register({
    definition: { name: 'workspace_probe', label: 'Probe', description: 'Probe workspace execution', inputSchema: Type.Object({}), replay: 'safe' },
    adapter: { create: () => ({ execute: async () => {
      active++
      maximum = Math.max(maximum, active)
      await gate
      active--
      return { content: [{ type: 'text', text: 'Probe done' }] }
    } }) },
  })
  await fixture.host.refreshTools(context())
  await fixture.host.bots!.update('coder', { workspaceIds: [fixture.workspaceId], enabledTools: ['workspace_probe'] })
  fixture.host.scheduledTasks = async () => ['active-schedule', 'future-schedule'].map((id) => ({ id, title: id, prompt: 'Probe', botId: 'coder', enabled: true, schedule: { type: 'once' as const, runAt: Date.now() + 60000 }, createdAt: 1, updatedAt: 1 }))
  for (const threadId of ['writer-one', 'writer-two']) {
    await fixture.host.create({ threadId, botId: 'coder', workspaceId: fixture.workspaceId }, context())
    await fixture.host.conversations.submit(threadId, { type: 'input', requestId: threadId, content: 'Probe', ...(threadId === 'writer-one' ? { scheduledTaskId: 'active-schedule' } : {}) }, context())
  }
  try {
    await vi.waitFor(async () => {
      const status = await fixture.host.activity.getStatus('coder', context())
      expect(status.activeThreads.map((thread) => thread.threadId).sort()).toEqual(['writer-one', 'writer-two'])
      expect(status.runningCount).toBe(2)
      expect(status.tasks).toContainEqual(expect.objectContaining({ taskId: 'active-schedule', kind: 'scheduled', status: 'running' }))
      expect(status.tasks).toContainEqual(expect.objectContaining({ taskId: 'future-schedule', kind: 'scheduled', status: 'scheduled' }))
      expect((await fixture.host.activity.listTasks('coder', context())).tasks).toContainEqual(expect.objectContaining({ threadId: 'writer-two', workspaceName: 'workspace' }))
    })
  } finally {
    release()
  }
  await vi.waitFor(async () => {
    for (const threadId of ['writer-one', 'writer-two']) expect(JSON.stringify(await fixture.host.conversations.snapshot(threadId, context()))).toContain('Done')
  }, { timeout: 15000 })
  expect(maximum).toBe(1)
})

test('await collaboration resumes the original tool after host restart without redispatching its submission', async () => {
  const fixture = await setup(false, (body) => {
    const target = body.messages.some((message) => message.role === 'system' && message.content.includes('RECOVERY_TARGET'))
    if (body.messages.some((message) => message.role === 'tool')) return target ? 'Recovered target result' : 'Recovered source summary'
    return target ? { name: 'slow_probe', arguments: {} } : { name: 'bot_request_task', arguments: { botId: 'coder', instruction: 'Recover this work' } }
  }, undefined, true)
  fixture.registry.register({
    definition: { name: 'slow_probe', label: 'Probe', description: 'Slow execution', inputSchema: Type.Object({}), replay: 'safe' },
    adapter: { create: () => ({ execute: async (_id: string, _args: unknown, signal?: AbortSignal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1000)
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
      })
      return { content: [{ type: 'text', text: 'Recovered probe' }] }
    } }) },
  })
  let host = fixture.host
  await host.refreshTools(context())
  await host.bots!.update('coder', { instructions: 'RECOVERY_TARGET', enabledTools: ['slow_probe'] })
  const source = await host.mainThread('xiaoya', context())
  await host.conversations.submit(source.id, { type: 'input', requestId: 'recover-await', content: 'Delegate work' }, context())
  let submissionId: number | undefined
  await vi.waitFor(async () => {
    const task = (await host.grove!.list(context())).tasks[0]
    expect(task?.submissionId).toBeDefined()
    submissionId = task.submissionId
  })
  await host.close()
  hosts.splice(hosts.indexOf(host), 1)
  host = await fixture.open()
  await vi.waitFor(async () => expect(JSON.stringify(await host.conversations.snapshot(source.id, context()))).toContain('Recovered source summary'), { timeout: 15000 })
  const tasks = (await host.grove!.list(context())).tasks
  expect(tasks).toHaveLength(1)
  expect(tasks[0]).toMatchObject({ status: 'completed', submissionId })
  expect((await host.conversations.snapshot(source.id, context())).entries.flatMap((entry) => entry.model ?? []).filter((message) => message.role === 'user')).toHaveLength(1)
}, 25000)

test('cancelling the source await call cancels its target and releases the collaboration queue', async () => {
  const fixture = await setup(false, (body) => {
    if (body.messages.some((message) => message.role === 'system' && message.content.includes('CANCEL_TARGET'))) return { name: 'cancel_probe', arguments: {} }
    return { name: 'bot_request_task', arguments: { botId: 'coder', instruction: 'Wait for cancellation' } }
  }, undefined, true)
  let entered = false
  fixture.registry.register({
    definition: { name: 'cancel_probe', label: 'Probe', description: 'Wait for cancellation', inputSchema: Type.Object({}), replay: 'safe' },
    adapter: { create: () => ({ execute: async (_id: string, _args: unknown, signal?: AbortSignal) => {
      entered = true
      await new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    } }) },
  })
  await fixture.host.refreshTools(context())
  await fixture.host.bots!.update('coder', { instructions: 'CANCEL_TARGET', enabledTools: ['cancel_probe'] })
  const source = await fixture.host.mainThread('xiaoya', context())
  await fixture.host.conversations.submit(source.id, { type: 'input', requestId: 'cancel-await', content: 'Delegate' }, context())
  await vi.waitFor(() => expect(entered).toBe(true))
  await fixture.host.conversations.cancel(source.id, context())
  await vi.waitFor(async () => expect((await fixture.host.grove!.list(context())).tasks[0]?.status).toBe('cancelled'))
  const task = (await fixture.host.grove!.list(context())).tasks[0]
  await vi.waitFor(async () => expect((await fixture.host.conversations.snapshot(task.targetThreadId!, context())).run).toBeUndefined())
  expect((await fixture.host.activity.getStatus('coder', context())).queuedCount).toBe(0)
})

test('expired collaboration deadlines settle as failures instead of waiting indefinitely', async () => {
  const fixture = await setup(false, undefined, undefined, true)
  const source = await fixture.host.mainThread('xiaoya', context())
  const caller = { threadId: source.id }
  const task = await fixture.host.grove!.requestTask(caller, { toBotId: 'coder', instruction: 'Time budget', operationId: 'expired' }, context())
  await fixture.host.bots!.withLock(`collaboration:${task.id}`, async () => {
    const current = await fixture.options.groveRepo!.getTask(task.id)
    await fixture.options.groveRepo!.putTask({ ...current!, deadline: Date.now() - 1 })
  })
  await vi.waitFor(async () => expect(await fixture.host.grove!.getTask(caller, task.id, context())).toMatchObject({ status: 'failed', result: 'Collaboration time budget exhausted' }))
})

test('recovery fails queued work explicitly when its Bot or Workspace is unavailable', async () => {
  const fixture = await setup(false, undefined, undefined, true)
  const helper = await fixture.host.bots!.create({ name: 'Temporary target' })
  await fixture.host.bots!.update('coder', { workspaceIds: [fixture.workspaceId] })
  const source = await fixture.host.mainThread('xiaoya', context())
  await fixture.host.close()
  hosts.splice(hosts.indexOf(fixture.host), 1)
  const host = await fixture.open(async (initializing) => {
    await initializing.coordination!.requestTask({ threadId: source.id }, { toBotId: helper.id, instruction: 'Removed target', operationId: 'removed' }, context())
    await initializing.coordination!.requestTask({ threadId: source.id }, { toBotId: 'coder', instruction: 'Unavailable workspace', workspaceId: fixture.workspaceId, operationId: 'detached' }, context())
    await initializing.bots!.remove(helper.id)
    await fixture.workspaces.detach(fixture.workspaceId)
  })
  await vi.waitFor(async () => {
    const tasks = (await host.coordination!.list(context())).tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.every((task) => task.status === 'failed')).toBe(true)
    expect(tasks.every((task) => task.submissionId === undefined)).toBe(true)
  })
  expect(fixture.requests).toHaveLength(0)
})

test('one source submission cannot restart collaboration chains indefinitely', async () => {
  const { host } = await setup(false, undefined, undefined, true)
  const source = await host.mainThread('xiaoya', context())
  const caller = { threadId: source.id }
  for (let index = 0; index < 8; index++) {
    const task = await host.coordination!.requestTask(caller, { toBotId: 'coder', instruction: `Task ${index}`, operationId: `bounded-${index}`, sourceSubmissionId: 999, mode: 'async' }, context())
    await host.coordination!.waitTask(caller, task.id, context())
  }
  await expect(host.coordination!.requestTask(caller, { toBotId: 'coder', instruction: 'Excess', operationId: 'bounded-excess', sourceSubmissionId: 999, mode: 'async' }, context())).rejects.toThrow('Source submission collaboration budget')
  expect((await host.coordination!.list(context())).tasks).toHaveLength(8)
}, 20000)

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

type ToolReply = { name: string; arguments: Record<string, unknown>; id?: string }
type Reply = string | ToolReply | ToolReply[]

async function setup(
  write = true,
  respond?: (body: Record<string, any>) => Reply,
  stream?: (response: ServerResponse) => Promise<void>,
  botProfiles = false,
) {
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push(body)
    if (stream) {
      await stream(response)
      return
    }
    const reply =
      respond?.(body) ??
      (write && !body.messages.some((message) => message.role === 'tool')
        ? { name: 'write', arguments: { path: 'file.txt', content: 'written by durable host' } }
        : 'complete')
    const call = typeof reply !== 'string'
    const calls = call ? (Array.isArray(reply) ? reply : [reply]) : []
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
                  tool_calls: calls.map((reply, index) => ({
                    index,
                    id: reply.id ?? 'write-call',
                    type: 'function',
                    function: { name: reply.name, arguments: JSON.stringify(reply.arguments) },
                  })),
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
    fileURLToPath(new URL('../../drizzle', import.meta.url)),
  )
  databases.push(database.close)
  const sessions = new DrizzleAgentSessionRepo(database.database)
  const workspaces = new WorkspaceService(new DrizzleWorkspaceRepo(database.database))
  const attached = await workspaces.attach(join(directory, 'workspace'))
  const workspaceId = attached.workspace!.id
  const credentials = new MemoryCredentialStore()
  credentials.setApiKey('custom', 'synthetic-key')
  const registry = new ToolRegistry()
  registerBuiltinTools(registry, '')
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
    ...(botProfiles ? { botRepo: new DrizzleBotRepo(database.database), groveRepo: new DrizzleGroveRepo(database.database) } : {}),
    workspaces,
    tools: registry,
    sandbox: new SandboxService({ support: () => 'partial', execute: vi.fn() }),
    retention: { process: async (_run, _call, result) => result },
    contextBuilder: new ContextBuilder(attachments, memory),
    skills: new SkillLoader(join(directory, 'skills')),
  }
  const open = async (initialize?: (host: AgentHost) => Promise<void>) => {
    const host = await AgentHost.open({ ...options, ...(initialize ? { initialize } : {}) }, BACKGROUND_CONTEXT)
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

test('creation persists the selected model atomically and retries preserve later configuration', async () => {
  const { host, config, setConfig, workspaceId, open } = await setup(false)
  setConfig({
    ...config,
    models: [
      { ...config.model, id: 'custom:custom-model' },
      { ...config.model, id: 'custom:alternate', modelID: 'alternate', reasoning: true },
    ],
  })
  await host.reload(context())
  await host.create(
    {
      threadId: 'selected-model',
      workspaceId,
      permissionMode: 'read-only',
      model: { provider: 'custom', modelId: 'alternate' },
      thinkingLevel: 'low',
    },
    context(),
  )
  expect((await host.conversations.snapshot('selected-model', context())).agent).toMatchObject({
    model: { provider: 'custom', modelId: 'alternate' },
    thinkingLevel: 'low',
  })
  await host.close()
  const restored = await open()
  expect((await restored.conversations.snapshot('selected-model', context())).agent).toMatchObject({
    model: { provider: 'custom', modelId: 'alternate' },
    thinkingLevel: 'low',
  })
  await restored.configure(
    'selected-model',
    { model: { provider: 'custom', modelId: 'custom-model' }, thinkingLevel: 'off' },
    context(),
  )
  await restored.create(
    {
      threadId: 'selected-model',
      workspaceId,
      permissionMode: 'full-access',
      model: { provider: 'custom', modelId: 'alternate' },
      thinkingLevel: 'low',
    },
    context(),
  )
  expect((await restored.conversations.snapshot('selected-model', context())).agent).toMatchObject({
    model: { provider: 'custom', modelId: 'custom-model' },
    thinkingLevel: 'off',
  })
  expect((await restored.conversations.get('selected-model', context())).permissionMode).toBe(
    'read-only',
  )
})

test('initialization failure releases ownership and preserves recovered permission without effects', async () => {
  const { host, options, workspaceId, open } = await setup()
  await host.create(
    { threadId: 'initialization-thread', workspaceId, permissionMode: 'read-only' },
    context(),
  )
  await host.conversations.submit(
    'initialization-thread',
    { type: 'input', content: 'Write', requestId: 'initialization-request' },
    context(),
  )
  await vi.waitFor(
    async () =>
      expect(await host.pendingApprovals('initialization-thread', context())).toHaveLength(1),
    { timeout: 15_000 },
  )
  await host.close()
  await expect(
    AgentHost.open(
      {
        ...options,
        initialize: async () => {
          throw new Error('Initialization fault')
        },
      },
      context(),
    ),
  ).rejects.toThrow('Initialization fault')
  const restored = await open()
  expect(
    (await restored.conversations.get('initialization-thread', context())).permissionMode,
  ).toBe('read-only')
  await restored.conversations.cancel('initialization-thread', context())
  await expect(readFile(join(directory, 'workspace', 'file.txt'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
}, 30000)

test('permission reductions remain authoritative when the metadata mirror fails and the host restarts', async () => {
  const { host, sessions, workspaceId, open } = await setup()
  await host.create(
    { threadId: 'permission-thread', workspaceId, permissionMode: 'full-access' },
    context(),
  )
  const conversation = await host.engine.conversation('permission-thread', context())
  const mirror = vi
    .spyOn(conversation, 'commit')
    .mockRejectedValueOnce(new Error('Mirror unavailable'))
  const resolve = vi.spyOn(host.engine, 'conversation').mockResolvedValue(conversation)
  await expect(
    host.conversations.update('permission-thread', { permissionMode: 'read-only' }, context()),
  ).rejects.toThrow('Mirror unavailable')
  expect((await sessions.findById('permission-thread'))?.permissionMode).toBe('read-only')
  mirror.mockRestore()
  resolve.mockRestore()
  await host.close()
  const recovered = await open()
  const accepted = await recovered.conversations.submit(
    'permission-thread',
    { type: 'input', content: 'Write', requestId: 'permission-request' },
    context(),
  )
  await vi.waitFor(
    async () =>
      expect(await recovered.pendingApprovals('permission-thread', context())).toHaveLength(1),
    { timeout: 15_000 },
  )
  await expect(readFile(join(directory, 'workspace', 'file.txt'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  const [approval] = await recovered.pendingApprovals('permission-thread', context())
  await recovered.decideApproval('permission-thread', approval.id, 'rejected', context())
  await (
    await recovered.engine.submission('permission-thread', accepted.submissionId, context())
  ).wait(context())
}, 30_000)

test('run and trace projections derive identities and outcomes from official task receipts across restart', async () => {
  const { host, open, workspaceId } = await setup()
  await host.create(
    { threadId: 'projection-thread', workspaceId, permissionMode: 'workspace-write' },
    context(),
  )
  const accepted = await host.conversations.submit(
    'projection-thread',
    { type: 'input', content: 'Write', requestId: 'projection-request' },
    context(),
  )
  await (
    await host.engine.submission('projection-thread', accepted.submissionId, context())
  ).wait(context())
  await (await host.engine.conversation('projection-thread', context())).waitForIdle(context())
  const projection = new RunProjection(host)
  const [run] = await projection.list('projection-thread', context())
  expect(run).toMatchObject({ status: 'completed', depth: 0, rootRunId: run.id })
  expect(run.toolCalls).toEqual([expect.objectContaining({ id: 'write-call', toolName: 'write' })])
  expect(run.toolResults).toEqual([
    expect.objectContaining({ toolCallId: 'write-call', status: 'success' }),
  ])
  const records = await projection.records(run.id, context())
  expect(records.map((record) => record.event.type)).toEqual([
    'agent_started',
    'user_message',
    'tool_started',
    'tool_finished',
    'text_delta',
    'agent_completed',
  ])
  await host.close()
  const recovered = new RunProjection(await open())
  expect(await recovered.list('projection-thread', context())).toEqual([run])
  expect(await recovered.records(run.id, context())).toEqual(records)
}, 30_000)

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
    adapter: { create: () => ({ execute: async () => ({ content: [] }) }) },
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
  const server = await startAgentHttpServer(host, {
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
    next: async (): Promise<AgentFrame> => {
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

test('HTTP reports busy and stale queues as conflicts and cancels execution before deletion', async () => {
  const { host, workspaceId } = await setup()
  const { request } = await api(host)
  await host.create(
    { threadId: 'continued-thread', workspaceId, permissionMode: 'read-only' },
    context(),
  )
  await host.create({ threadId: 'unrelated-thread' }, context())
  expect((await host.conversations.snapshot('continued-thread', context())).entries).toEqual([])
  const first = await (
    await request('/threads/continued-thread/submissions', 'POST', {
      type: 'input',
      content: 'Write',
      requestId: 'first',
    })
  ).json()
  await vi.waitFor(
    async () => expect(await host.pendingApprovals('continued-thread', context())).toHaveLength(1),
    { timeout: 15_000 },
  )
  expect(
    (
      await request('/threads/continued-thread/submissions', 'POST', {
        type: 'input',
        content: 'Busy',
        requestId: 'busy',
      })
    ).status,
  ).toBe(409)
  const queued = await (
    await request('/threads/continued-thread/submissions', 'POST', {
      type: 'input',
      content: 'Queued',
      requestId: 'queued',
      whenBusy: 'followUp',
    })
  ).json()
  expect(
    (
      await request('/threads/continued-thread/queue/item', 'POST', {
        mode: 'followUp',
        expected: ['stale'],
        index: 0,
        action: 'remove',
      })
    ).status,
  ).toBe(409)
  expect(
    (
      await request('/threads/continued-thread/queue/item', 'POST', {
        mode: 'followUp',
        expected: ['Queued'],
        index: 0,
        action: 'move',
        value: 1,
      })
    ).status,
  ).toBe(400)
  expect(
    (await request(`/threads/unrelated-thread/submissions/${queued.submissionId}`, 'DELETE'))
      .status,
  ).toBe(404)
  const steer = {
    mode: 'followUp', itemId: String(queued.submissionId), expected: ['stale'], index: 4, action: 'steer',
  }
  expect((await request('/threads/continued-thread/queue/item', 'POST', steer)).status).toBe(200)
  const repeated = await request('/threads/continued-thread/queue/item', 'POST', steer)
  expect(repeated.status).toBe(200)
  expect(await repeated.json()).toEqual([
    expect.objectContaining({ id: queued.submissionId, mode: 'steer' }),
  ])
  const imageQueued = await (await request('/threads/continued-thread/submissions', 'POST', {
    type: 'input', content: [{ type: 'text', text: 'Image message' }, { type: 'image', data: 'c3ludGhldGlj', mimeType: 'image/png' }],
    requestId: 'image-queued', whenBusy: 'followUp',
  })).json()
  expect((await request('/threads/continued-thread/queue/item', 'POST', {
    mode: 'followUp', expected: ['Image message\n[image]'], index: 0, action: 'move', value: 0,
  })).status).toBe(200)
  const remove = { mode: 'followUp', itemId: String(queued.submissionId), expected: ['stale'], index: 9, action: 'remove' }
  expect((await request('/threads/continued-thread/queue/item', 'POST', remove)).status).toBe(200)
  const removedAgain = await request('/threads/continued-thread/queue/item', 'POST', remove)
  expect(removedAgain.status).toBe(200)
  expect(await removedAgain.json()).toEqual([expect.objectContaining({ id: imageQueued.submissionId, mode: 'followUp' })])
  const alreadyPlaced = await request('/threads/continued-thread/queue/item', 'POST', {
    ...remove, itemId: String(first.submissionId), index: 0,
  })
  expect(alreadyPlaced.status).toBe(200)
  expect(await alreadyPlaced.json()).toEqual([expect.objectContaining({ id: imageQueued.submissionId, mode: 'followUp' })])
  expect(await host.pendingApprovals('continued-thread', context())).toHaveLength(1)
  expect((await host.conversations.status('continued-thread', queued.submissionId, context())).status).toBe('unanswered')
  await request('/threads/continued-thread', 'DELETE')
  expect(await host.pendingApprovals('continued-thread', context())).toEqual([])
  expect(
    (await host.conversations.status('continued-thread', first.submissionId, context())).status,
  ).toBe('unanswered')
}, 30_000)

test('HTTP creates a workspace conversation with draft model choices and accepts its first message', async () => {
  const { host, workspaceId } = await setup(false, undefined, undefined, true)
  await host.bots!.update('coder', { workspaceIds: [workspaceId] })
  const { request } = await api(host)
  const creation = {
    threadId: 'workspace-draft',
    botId: 'coder',
    workspaceId,
    permissionMode: 'read-only',
    model: { provider: 'custom', modelId: 'custom-model' },
    thinkingLevel: 'off',
  }
  expect((await request('/threads', 'POST', creation)).status).toBe(201)
  const loaded = await (await request('/threads/workspace-draft')).json()
  expect(loaded.snapshot.agent).toMatchObject({ model: creation.model, thinkingLevel: 'off' })
  const submission = await request('/threads/workspace-draft/submissions', 'POST', {
    type: 'input', requestId: 'first-message', content: 'hello from workspace',
  })
  expect(submission.status).toBe(202)
  const receipt = await submission.json()
  await (await host.engine.submission(creation.threadId, receipt.submissionId, context())).wait(context())
  const result = await (await request('/threads/workspace-draft')).json()
  expect(JSON.stringify(result.snapshot.entries)).toContain('hello from workspace')
  expect(JSON.stringify(result.snapshot.entries)).toContain('complete')
  expect((await (await request('/threads')).json()).find((thread) => thread.id === creation.threadId)).toMatchObject({ title: 'hello from workspace', workspaceId })
  for (const invalid of [
    { ...creation, threadId: 'invalid-model', model: { provider: '', modelId: 'custom-model' } },
    { ...creation, threadId: 'invalid-thinking', thinkingLevel: 'invalid' },
  ]) expect((await request('/threads', 'POST', invalid)).status).toBe(400)
}, 30_000)

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

test('three simultaneous delegation calls admit at most two children and recovery reuses both child identities', async () => {
  const { host, open, workspaceId, config, setConfig, requests } = await setup(false, (body) => {
    if (body.messages.some((message) => message.role === 'tool')) return 'complete'
    const user = JSON.stringify(
      body.messages.filter((message) => message.role === 'user').at(-1)?.content,
    )
    if (user.includes('root-secret'))
      return [0, 1, 2].map((index) => ({
        name: 'delegate_task',
        id: `delegate-${index}`,
        arguments: { task: `child-only-${index}`, context: 'explicit context only' },
      }))
    const index = /child-only-([0-2])/.exec(user)![1]
    return {
      name: 'write',
      id: `child-write-${index}`,
      arguments: { path: `child-${index}.txt`, content: 'once' },
    }
  })
  setConfig({ ...config, tools: { enabled: ['delegate_task', 'write'] } })
  await host.reload(context())
  await host.create(
    { threadId: 'concurrent-thread', workspaceId, permissionMode: 'read-only' },
    context(),
  )
  const accepted = await host.conversations.submit(
    'concurrent-thread',
    { type: 'input', content: 'root-secret', requestId: 'concurrent-request' },
    context(),
  )
  await vi.waitFor(
    async () => expect(await host.pendingApprovals('concurrent-thread', context())).toHaveLength(2),
    { timeout: 15_000 },
  )
  const approvals = await host.pendingApprovals('concurrent-thread', context())
  const ids = await host.engine.ownedConversationIds('concurrent-thread', context())
  expect(ids).toHaveLength(3)
  await vi.waitFor(
    async () =>
      expect(
        JSON.stringify((await host.conversations.snapshot('concurrent-thread', context())).entries),
      ).toContain('At most two child conversations'),
    { timeout: 15_000 },
  )
  const child = ids.find((id) => id !== accepted.conversationId)!
  const owner = (await host.engine.harness.inspect(context())).tasks.find(
    ({ record }) => record.conversationId === accepted.conversationId && record.kind === 'pi.tool',
  )!.record
  await expect(
    host.delegation.tool.execute(
      { task: 'nested attempt' },
      {
        conversationId: child,
        taskId: owner.id,
        agent: () =>
          host.engine
            .conversation('concurrent-thread', context())
            .then((conversation) => conversation.agent(context())),
        commit: (change: Parameters<typeof host.engine.harness.commit>[0]) =>
          host.engine.harness.commit(change, context()),
      } as never,
      context(),
    ),
  ).rejects.toThrow('Child conversations cannot delegate')
  expect(
    (await host.engine.ownedConversationIds('concurrent-thread', context())).sort((a, b) => a - b),
  ).toEqual([...ids].sort((a, b) => a - b))
  await host.close()
  const recovered = await open()
  expect(
    (await recovered.engine.ownedConversationIds('concurrent-thread', context())).sort(
      (a, b) => a - b,
    ),
  ).toEqual([...ids].sort((a, b) => a - b))
  expect(
    (await recovered.pendingApprovals('concurrent-thread', context())).sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  ).toEqual([...approvals].sort((a, b) => a.id.localeCompare(b.id)))
  for (const approval of approvals)
    await recovered.decideApproval('concurrent-thread', approval.id, 'approved', context())
  await (
    await recovered.engine.submission('concurrent-thread', accepted.submissionId, context())
  ).wait(context())
  await (await recovered.engine.conversation('concurrent-thread', context())).waitForIdle(context())
  for (const approval of approvals)
    expect(
      await readFile(join(directory, 'workspace', String(approval.arguments.path)), 'utf8'),
    ).toBe('once')
  const children = requests.filter((body) =>
    JSON.stringify(
      (body.messages as any[]).filter((message) => message.role === 'user').at(-1)?.content,
    ).includes('child-only'),
  )
  expect(children).toHaveLength(4)
  for (const request of children) {
    expect(JSON.stringify(request)).not.toContain('root-secret')
    expect(JSON.stringify(request)).toContain('explicit context only')
  }
  const runs = await new RunProjection(recovered).list('concurrent-thread', context())
  expect(runs.filter((run) => run.depth === 1)).toHaveLength(2)
}, 30_000)

test('activity projection shows reasoning before text and completion over a custom streaming endpoint', async () => {
  let releaseText!: () => void
  let releaseFinish!: () => void
  const textReady = new Promise<void>((resolve) => {
    releaseText = resolve
  })
  const finishReady = new Promise<void>((resolve) => {
    releaseFinish = resolve
  })
  const { host, workspaceId } = await setup(false, undefined, async (response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta: Record<string, string>, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({
          id: 'stream-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'custom-model',
          choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`,
      )
    chunk({ role: 'assistant', reasoning_content: 'Live reasoning' })
    await textReady
    chunk({ content: 'Live answer' })
    await finishReady
    chunk({}, 'stop')
    response.end('data: [DONE]\n\n')
  })
  try {
    await host.create(
      { threadId: 'stream-activity', workspaceId, permissionMode: 'read-only' },
      context(),
    )
    const accepted = await host.conversations.submit(
      'stream-activity',
      { type: 'input', content: 'Think', requestId: 'stream-request' },
      context(),
    )
    const projection = new RunProjection(host)
    let runId = ''
    await vi.waitFor(
      async () => {
        const runs = await projection.list('stream-activity', context())
        runId = runs[0]?.id ?? ''
        expect(runId).not.toBe('')
        const records = await projection.records(runId, context())
        expect(
          records.some(
            (record) =>
              record.event.type === 'thinking_delta' && record.event.text === 'Live reasoning',
          ),
        ).toBe(true)
        expect(records.some((record) => record.event.type === 'agent_completed')).toBe(false)
        expect(records.some((record) => record.event.type === 'text_delta')).toBe(false)
      },
      { timeout: 10000 },
    )
    releaseText()
    await vi.waitFor(
      async () => {
        const records = await projection.records(runId, context())
        expect(records.map((record) => record.event.type)).toEqual([
          'agent_started',
          'user_message',
          'thinking_delta',
          'text_delta',
        ])
      },
      { timeout: 10000 },
    )
    releaseFinish()
    await (
      await host.engine.submission('stream-activity', accepted.submissionId, context())
    ).wait(context())
    await (await host.engine.conversation('stream-activity', context())).waitForIdle(context())
    expect((await projection.records(runId, context())).map((record) => record.event.type)).toEqual(
      ['agent_started', 'user_message', 'thinking_delta', 'text_delta', 'agent_completed'],
    )
  } finally {
    releaseText()
    releaseFinish()
  }
}, 30000)

test('Bot HTTP CRUD persists stable main references and prevents built-in deletion', async () => {
  const { host, open } = await setup(false, undefined, undefined, true)
  const server = await startAgentHttpServer(host)
  httpServers.push(server)
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(server.baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  expect((await (await request('/bots')).json()).map((bot: any) => bot.name)).toEqual([
    '小芽',
    'Coder',
  ])
  const created = await (await request('/bots', 'POST', { name: 'Scout' })).json()
  expect(created.isBuiltIn).toBe(false)
  expect(
    (
      await request('/bots', 'POST', {
        name: 'Invalid',
        avatar: { seed: 'x', variant: 'remote-api', colors: [], accentColor: 'red' },
      })
    ).status,
  ).toBe(400)
  expect((await request('/bots/' + created.id, 'PATCH', { id: 'other' })).status).toBe(400)
  const main = await Promise.all(
    Array.from({ length: 5 }, () =>
      request('/bots/' + created.id + '/main-thread', 'POST').then((response) => response.json()),
    ),
  )
  expect(new Set(main.map((thread) => thread.id)).size).toBe(1)
  expect(main[0].botId).toBe(created.id)
  expect(
    (await request('/bots/coder', 'DELETE', { strategy: 'archive-conversations' })).status,
  ).toBe(409)
  await server.close()
  await host.close()
  const reopened = await open()
  expect((await reopened.bots!.get(created.id)).mainThreadId).toBe(main[0].id)
  await reopened.deleteBot(created.id, context())
  await expect(reopened.bots!.get(created.id)).rejects.toThrow('not found')
  expect((await reopened.conversations.get(main[0].id, context())).archived).toBe(true)
})

test('Bot identity and tool loadouts stay independent of Workspace; Coding Bot loads authorized instructions', async () => {
  const { host, workspaceId, requests, config, setConfig } = await setup(
    false,
    undefined,
    undefined,
    true,
  )
  setConfig({
    ...config,
    models: [
      { ...config.model, id: 'custom:custom-model' },
      { ...config.model, id: 'custom:alternate', modelID: 'alternate', reasoning: true },
    ],
  })
  await host.reload(context())
  await host.bots!.update('xiaoya', {
    workspaceIds: [workspaceId],
    enabledTools: ['read'],
    instructions: 'PERSONAL_IDENTITY_SENTINEL',
  })
  await host.create({ threadId: 'personal-bot', botId: 'xiaoya', workspaceId }, context())
  const personal = await host.conversations.submit(
    'personal-bot',
    { type: 'input', requestId: 'personal-input', content: 'Hello' },
    context(),
  )
  await (
    await host.engine.submission('personal-bot', personal.submissionId, context())
  ).wait(context())
  expect(JSON.stringify(requests[0])).toContain('PERSONAL_IDENTITY_SENTINEL')
  expect(JSON.stringify(requests[0])).not.toContain('Actual host workspace instructions')
  expect((requests[0].tools as any[]).map((tool) => tool.function.name)).toEqual(['read'])
  await host.bots!.update('coder', {
    workspaceIds: [workspaceId],
    enabledTools: ['read', 'write'],
    model: { provider: 'custom', modelId: 'alternate' },
    thinkingLevel: 'low',
  })
  await host.create({ threadId: 'coding-bot', botId: 'coder', workspaceId }, context())
  const coding = await host.conversations.submit(
    'coding-bot',
    { type: 'input', requestId: 'coding-input', content: 'Hello' },
    context(),
  )
  await (await host.engine.submission('coding-bot', coding.submissionId, context())).wait(context())
  expect(JSON.stringify(requests.at(-1))).toContain('Actual host workspace instructions')
  expect(requests.at(-1)?.model).toBe('alternate')
  await expect(
    host.create({ threadId: 'coding-bot', botId: 'xiaoya', workspaceId }, context()),
  ).rejects.toThrow('another Bot')
  await expect(
    host.create(
      { threadId: 'unsafe', botId: 'xiaoya', workspaceId, permissionMode: 'full-access' },
      context(),
    ),
  ).rejects.toThrow('exceeds Bot')
  await host.bots!.update('xiaoya', { workspaceIds: [] })
  await expect(
    host.conversations.submit(
      'personal-bot',
      { type: 'input', requestId: 'revoked-input', content: 'Read' },
      context(),
    ),
  ).rejects.toThrow('revoked')
})

test('running Submissions retain configuration and queued Submissions capture edits across restart', async () => {
  const { host, open, workspaceId, requests, config, setConfig } = await setup(
    true,
    undefined,
    undefined,
    true,
  )
  setConfig({
    ...config,
    models: [
      { ...config.model, id: 'custom:custom-model' },
      { ...config.model, id: 'custom:alternate', modelID: 'alternate', reasoning: true },
    ],
  })
  await host.reload(context())
  await host.bots!.update('coder', {
    workspaceIds: [workspaceId],
    enabledTools: ['read', 'write'],
    instructions: 'OLD_BOT_INSTRUCTIONS',
  })
  await host.create(
    { threadId: 'captured-bot', botId: 'coder', workspaceId, permissionMode: 'read-only' },
    context(),
  )
  const first = await host.conversations.submit(
    'captured-bot',
    { type: 'input', requestId: 'captured-first', content: 'Write' },
    context(),
  )
  await vi.waitFor(
    async () => expect(await host.pendingApprovals('captured-bot', context())).toHaveLength(1),
    { timeout: 15_000 },
  )
  await host.bots!.update('coder', {
    instructions: 'NEW_BOT_INSTRUCTIONS',
    model: { provider: 'custom', modelId: 'alternate' },
  })
  const second = await host.conversations.submit(
    'captured-bot',
    { type: 'input', requestId: 'captured-second', content: 'Review', whenBusy: 'followUp' },
    context(),
  )
  await host.close()
  const restored = await open()
  const [approval] = await restored.pendingApprovals('captured-bot', context())
  await restored.decideApproval('captured-bot', approval.id, 'approved', context())
  await (
    await restored.engine.submission('captured-bot', first.submissionId, context())
  ).wait(context())
  await (
    await restored.engine.submission('captured-bot', second.submissionId, context())
  ).wait(context())
  expect(requests.map((request) => request.model)).toEqual([
    'custom-model',
    'custom-model',
    'alternate',
  ])
  expect(JSON.stringify(requests[1])).toContain('OLD_BOT_INSTRUCTIONS')
  expect(JSON.stringify(requests[1])).not.toContain('NEW_BOT_INSTRUCTIONS')
  expect(JSON.stringify(requests[2])).toContain('NEW_BOT_INSTRUCTIONS')
  const retry = await restored.conversations.submit(
    'captured-bot',
    { type: 'input', requestId: 'captured-second', content: 'Review', whenBusy: 'followUp' },
    context(),
  )
  expect(retry.submissionId).toBe(second.submissionId)
  expect(requests).toHaveLength(3)
}, 30_000)

test.each(['tool', 'workspace', 'detach'])(
  'pending approval cannot outlive %s revocation or restart',
  async (change) => {
    const { host, open, workspaceId, workspaces } = await setup(true, undefined, undefined, true)
    await host.bots!.update('coder', { workspaceIds: [workspaceId], enabledTools: ['write'] })
    await host.create(
      { threadId: 'revoked-bot', botId: 'coder', workspaceId, permissionMode: 'read-only' },
      context(),
    )
    const submitted = await host.conversations.submit(
      'revoked-bot',
      { type: 'input', requestId: 'revocation-request', content: 'Write' },
      context(),
    )
    await vi.waitFor(
      async () => expect(await host.pendingApprovals('revoked-bot', context())).toHaveLength(1),
      { timeout: 15_000 },
    )
    if (change === 'tool') await host.bots!.update('coder', { enabledTools: [] })
    else if (change === 'workspace') await host.bots!.update('coder', { workspaceIds: [] })
    else await workspaces.detach(workspaceId)
    await host.close()
    const restored = await open()
    const approvals = await restored.pendingApprovals('revoked-bot', context())
    if (approvals[0])
      await restored
        .decideApproval('revoked-bot', approvals[0].id, 'approved', context())
        .catch(() => undefined)
    await (
      await restored.engine.submission('revoked-bot', submitted.submissionId, context())
    ).wait(context())
    await expect(readFile(join(directory, 'workspace', 'file.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  },
  30_000,
)

test('Bot deletion and Workspace changes cannot race new admissions', async () => {
  const { host, workspaceId } = await setup(true, undefined, undefined, true)
  const bot = await host.bots!.create({
    name: 'Developer',
    kind: 'coding',
    workspaceIds: [workspaceId],
    enabledTools: ['write'],
    permissionMode: 'workspace-write',
  })
  await host.create(
    { threadId: 'lifecycle-bot', botId: bot.id, workspaceId, permissionMode: 'read-only' },
    context(),
  )
  const admitted = await host.conversations.submit(
    'lifecycle-bot',
    { type: 'input', requestId: 'lifecycle-admitted', content: 'Write' },
    context(),
  )
  await vi.waitFor(
    async () => expect(await host.pendingApprovals('lifecycle-bot', context())).toHaveLength(1),
    { timeout: 15_000 },
  )
  await expect(host.deleteBot(bot.id, context())).rejects.toThrow('running or queued')
  await expect(
    host.conversations.update('lifecycle-bot', { workspaceId: null }, context()),
  ).rejects.toThrow('while Tasks are running')
  await host.conversations.cancel('lifecycle-bot', context())
  await host.deleteBot(bot.id, context())
  await expect(
    host.conversations.submit(
      'lifecycle-bot',
      { type: 'input', requestId: 'lifecycle-after-delete', content: 'Write' },
      context(),
    ),
  ).rejects.toThrow('not found')
  expect(
    (await host.conversations.status('lifecycle-bot', admitted.submissionId, context())).status,
  ).toBe('unanswered')
  await expect(readFile(join(directory, 'workspace', 'file.txt'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
})

test('Remote browser uses durable Bots, model overrides, queued inputs, cancellation and approvals', async () => {
  const fixture = await setup(
    false,
    (body) => {
      const user = JSON.stringify(
        body.messages.filter((message: any) => message.role === 'user').at(-1)?.content,
      )
      return user.includes('approval-effect') && body.messages.at(-1)?.role !== 'tool'
        ? { name: 'write', id: 'effect-call', arguments: { path: 'effect.txt', content: 'once' } }
        : 'Production host accepted.'
    },
    undefined,
    true,
  )
  const configured = {
    ...fixture.config,
    models: [
      { ...fixture.config.model, id: 'custom:custom-model', modelName: 'Test', reasoning: true },
      {
        ...fixture.config.model,
        id: 'test-provider:gpt-5.4',
        provider: 'test-provider',
        modelID: 'gpt-5.4',
        modelName: 'Alternate',
        reasoning: true,
        contextWindow: 65536,
      },
    ],
  }
  fixture.setConfig(configured)
  fixture.options.credentials().setApiKey('test-provider', 'synthetic-key')
  await fixture.host.reload(context())
  const config = new AgentConfigStore(configured)
  const port = createRemoteAgentPort(
    fixture.workspaces,
    fixture.host,
    config,
    () => {},
    fixture.attachments,
  )
  let base = ''
  const gateway = await startRemoteGateway(port, {
    port: 0,
    staticRoot: join(process.cwd(), 'apps/remote/dist'),
    identity: () => ({ allowedLogin: 'test@local', origin: base }),
  })
  base = 'http://127.0.0.1:' + gateway.port
  try {
    const path = join(directory, 'remote-browser.mjs')
    const script = `
import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
app.setPath('userData', ${JSON.stringify(join(directory, 'browser-data'))})
app.whenReady().then(async () => {
  const browser = new BrowserWindow({ show: false, width: 1100, height: 820, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  browser.webContents.session.webRequest.onBeforeSendHeaders({ urls: [${JSON.stringify(base + '/*')}] }, (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, 'tailscale-user-login': 'test@local' } }))
  try {
    await browser.loadURL(${JSON.stringify(base)})
    const result = await browser.webContents.executeJavaScript(${JSON.stringify('(' + verifyRemote.toString() + ')("gpt-5.4")')})
    const screenshots = ${JSON.stringify(process.env.NOOK_BOT_SCREENSHOTS ?? '')}
    if (screenshots) {
      await mkdir(screenshots, { recursive: true })
      await new Promise(resolve => setTimeout(resolve, 500))
      await writeFile(join(screenshots, 'remote-bot-chat.png'), (await browser.webContents.capturePage()).toPNG())
    }
    browser.setSize(390, 844)
    const mobile = await browser.webContents.executeJavaScript(${JSON.stringify('(' + verifyRemoteMobile.toString() + ')()')})
    if (!mobile.created) throw new Error('Mobile Bot creation failed')
    if (screenshots) {
      await new Promise(resolve => setTimeout(resolve, 500))
      await writeFile(join(screenshots, 'mobile-bot-chat.png'), (await browser.webContents.capturePage()).toPNG())
    }
    process.stdout.write('REMOTE_BOT_SMOKE=' + JSON.stringify(result) + '\\n')
    browser.destroy()
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
`
    await writeFile(path, script)
    await promisify(execFile)(process.execPath, ['--check', path], { windowsHide: true })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const { stdout } = await promisify(execFile)(
      createRequire(import.meta.url)('electron'),
      [path],
      { env, windowsHide: true, timeout: 90000 },
    )
    expect(stdout).toContain('REMOTE_BOT_SMOKE=')
    const result = JSON.parse(
      stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith('REMOTE_BOT_SMOKE='))!
        .slice('REMOTE_BOT_SMOKE='.length),
    )
    expect(result).toMatchObject({
      sent: true,
      queue: true,
      cancel: true,
      approval: true,
      configuration: true,
    })
    expect(await readFile(join(directory, 'workspace', 'effect.txt'), 'utf8')).toBe('once')
  } finally {
    await gateway.close()
  }
}, 120000)

test('scheduled tasks persist their Bot and dispatch using its identity', async () => {
  const fixture = await setup(false, undefined, undefined, true)
  await fixture.host.close()
  const tasks = new Map<string, ScheduledTask>()
  const scheduler = new AgentScheduler({
    findAll: async () => [...tasks.values()],
    findEnabled: async () => [...tasks.values()].filter((task) => task.enabled),
    findById: async (id) => tasks.get(id),
    save: async (task) => {
      tasks.set(task.id, task)
    },
    delete: async (id) => {
      tasks.delete(id)
    },
  })
  const host = await AgentHost.open(
    {
      ...fixture.options,
      extensions: [scheduler.extension],
      initialize: async (initializing) => {
        scheduler.connect(initializing)
      },
    },
    context(),
  )
  hosts.push(host)
  const task = await scheduler.create({
    title: 'Coding review',
    prompt: 'Review the project',
    botId: 'coder',
    schedule: { type: 'once', runAt: Date.now() - 1 },
  })
  expect(task.botId).toBe('coder')
  await vi.waitFor(() => expect(tasks.get(task.id)?.lastRunAt).toBeDefined(), { timeout: 15000 })
  const thread = (await host.conversations.list(context())).find(
    (thread) => thread.title === task.title,
  )
  expect(thread?.botId).toBe('coder')
  expect(JSON.stringify(fixture.requests)).toContain(
    'You are the KKlyeeNook coding assistant.',
  )
  await expect(
    scheduler.create({
      title: 'Wrong Bot',
      prompt: 'Review',
      botId: 'xiaoya',
      sessionId: thread!.id,
      schedule: { type: 'once', runAt: Date.now() + 10000 },
    }),
  ).rejects.toThrow('another Bot')
})
