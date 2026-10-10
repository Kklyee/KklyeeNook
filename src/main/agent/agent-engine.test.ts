import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import { createRegistry } from '@earendil-works/pi-durable'
import { connectDatabase } from '../db/client'
import { DrizzleAgentSessionRepo, type AgentSessionRepo } from '../db/repositories/agentSessionRepo'
import { AgentEngine } from './agent-engine'
import { ConversationService } from './conversation-service'

let directory: string
const engines: AgentEngine[] = []
const databases: Array<() => void> = []
const children: ChildProcess[] = []
const context = () => withAbortSignal(AbortSignal.timeout(15_000), BACKGROUND_CONTEXT)
const model = { provider: 'faux', modelId: 'faux-1' }

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-engine-'))
})

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  }
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  for (const close of databases.splice(0)) close()
  await rm(directory, { recursive: true, force: true })
})

async function setup(options: Parameters<typeof fauxProvider>[0] = {}) {
  const faux = fauxProvider(options)
  const models = createModels()
  models.setProvider(faux.provider)
  const harnessOptions = {
    models,
    registry: createRegistry(),
    settings: { retry: { enabled: false } },
  }
  const path = join(directory, 'agent-durable.sqlite')
  const open = async () => {
    const engine = await AgentEngine.open(path, harnessOptions, context())
    engines.push(engine)
    return engine
  }
  const engine = await open()
  const database = await connectDatabase(
    'file::memory:',
    fileURLToPath(new URL('../../../drizzle', import.meta.url)),
  )
  databases.push(database.close)
  const repo = new DrizzleAgentSessionRepo(database.database)
  return {
    engine,
    open,
    path,
    harnessOptions,
    faux,
    repo,
    service: new ConversationService(engine, repo),
  }
}

test('persists business metadata and atomic ID mappings without duplicate concurrent inputs', async () => {
  const { engine, open, faux, repo, service } = await setup()
  faux.setResponses([fauxAssistantMessage('complete')])
  const input = { threadId: 'thread', title: 'Title', agent: { model } }
  await Promise.all([service.create(input, context()), service.create(input, context())])
  expect(await service.list(context())).toHaveLength(1)
  const conversation = await engine.conversation('thread', context())
  expect((await conversation.agent(context())).tools).toEqual([])
  expect((await conversation.agent(context())).extensions).toEqual([])
  const request = { type: 'input', content: 'Hello', requestId: 'same-request' } as const
  const accepted = await Promise.all([
    service.submit('thread', request, context()),
    service.submit('thread', request, context()),
  ])
  expect(accepted[0]).toEqual(accepted[1])
  expect(accepted[0].accepted).toBe(true)
  const submission = await engine.submission('thread', accepted[0].submissionId, context())
  expect((await submission.wait(context())).status).toBe('done')
  await conversation.waitForIdle(context())
  expect(faux.state.callCount).toBe(1)
  const closing = engine.close()
  expect(engine.close()).toBe(closing)
  await closing
  const restored = await open()
  const restoredService = new ConversationService(restored, repo)
  expect((await restoredService.get('thread', context())).title).toBe('Title')
  expect(await restoredService.submit('thread', request, context())).toEqual(accepted[0])
  expect((await restoredService.status('thread', accepted[0].submissionId, context())).status).toBe(
    'done',
  )
  expect(
    (await restoredService.snapshot('thread', context())).entries.filter(
      (entry) => entry.kind === 'pi.user',
    ),
  ).toHaveLength(1)
  expect(faux.state.callCount).toBe(1)
})

test('hides an unpublished conversation and safely retries metadata publication after reopen', async () => {
  const { engine, open, repo } = await setup()
  const failing: AgentSessionRepo = {
    findAll: () => repo.findAll(),
    findById: (id) => repo.findById(id),
    delete: (id) => repo.delete(id),
    save: async () => {
      throw new Error('metadata unavailable')
    },
  }
  const service = new ConversationService(engine, failing)
  const input = { threadId: 'retry-create', title: 'Original title', agent: { model } }
  await expect(service.create(input, context())).rejects.toThrow('metadata unavailable')
  expect(await service.list(context())).toEqual([])
  await expect(service.get(input.threadId, context())).rejects.toThrow('Conversation not found')
  const id = (await engine.conversation(input.threadId, context())).id
  await engine.close()
  const restored = await open()
  const published = await new ConversationService(restored, repo).create(
    { ...input, title: 'Retry title' },
    context(),
  )
  expect(published.title).toBe('Original title')
  expect((await restored.conversation(input.threadId, context())).id).toBe(id)
  expect(await repo.findAll()).toHaveLength(1)
  await repo.save({ id: 'historical', title: 'Old', createdAt: 1, updatedAt: 1, archived: false })
  await expect(
    new ConversationService(restored, repo).create({ ...input, threadId: 'historical' }, context()),
  ).rejects.toThrow('read-only')
  expect((await repo.findById('historical'))?.title).toBe('Old')
})

test('keeps model failures authoritative and prevents cross-conversation submission access', async () => {
  const { engine, faux, service } = await setup()
  faux.setResponses([
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'model failed' }),
  ])
  await service.create({ threadId: 'failed', agent: { model } }, context())
  await service.create({ threadId: 'other', agent: { model } }, context())
  await expect(
    service.submit('failed', { type: 'input', content: 'Hello', requestId: '' }, context()),
  ).rejects.toThrow('stable request ID')
  const accepted = await service.submit(
    'failed',
    { type: 'input', content: 'Hello', requestId: 'error' },
    context(),
  )
  const settled = await (
    await engine.submission('failed', accepted.submissionId, context())
  ).wait(context())
  expect(settled.status).toBe('unanswered')
  expect((await service.status('failed', accepted.submissionId, context())).status).toBe(
    'unanswered',
  )
  await expect(service.withdraw('other', accepted.submissionId, context())).rejects.toThrow(
    'not found in this conversation',
  )
})

test('withdraws one queued submission, aborts current work and stops event watches on close', async () => {
  const { engine, faux, service } = await setup({
    tokensPerSecond: 20,
    tokenSize: { min: 1, max: 1 },
  })
  faux.setResponses([fauxAssistantMessage('long reply '.repeat(100))])
  await service.create({ threadId: 'busy', agent: { model } }, context())
  const watch = await engine.watch('busy', context())
  expect(watch.snapshot.type).toBe('snapshot')
  const events: string[] = []
  watch.start(async (batch) => {
    events.push(...batch.map((event) => event.type))
  })
  const first = await service.submit(
    'busy',
    { type: 'input', content: 'First', requestId: 'first' },
    context(),
  )
  await vi.waitFor(() => expect(faux.state.callCount).toBe(1))
  const second = await service.submit(
    'busy',
    { type: 'input', content: 'Second', requestId: 'second' },
    context(),
  )
  expect((await service.status('busy', second.submissionId, context())).status).toBe('queued')
  expect(await service.withdraw('busy', second.submissionId, context())).toBe('aborted')
  await service.cancel('busy', context())
  expect((await service.status('busy', first.submissionId, context())).status).toBe('unanswered')
  expect((await service.status('busy', second.submissionId, context())).status).toBe('unanswered')
  expect((await engine.harness.inspect(context())).tasks).toHaveLength(0)
  await engine.close()
  await expect(watch.closed).resolves.toBeDefined()
  expect(events).toContain('run_start')
})

test('rolls back failed creation and rejects admission after shutdown', async () => {
  const { engine } = await setup()
  await expect(
    engine.create('rolled-back', { model }, context(), async () => {
      throw new Error('initialization failed')
    }),
  ).rejects.toThrow('initialization failed')
  expect(Object.hasOwn(await engine.links(context()), 'rolled-back')).toBe(false)
  await expect(engine.conversation('rolled-back', context())).rejects.toThrow('not found')
  await engine.close()
  await expect(engine.create('late', { model }, context())).rejects.toThrow('closed')
})

test('initializes host integrations before recovery and releases storage after initialization failure', async () => {
  const { engine, path, harnessOptions, open } = await setup()
  await engine.close()
  await expect(AgentEngine.open(path, harnessOptions, context(), async (initializing) => {
    expect((await initializing.harness.inspect(context())).scheduling).toBe('paused')
    throw new Error('host integration failed')
  })).rejects.toThrow('host integration failed')
  const restored = await open()
  expect((await restored.harness.inspect(context())).scheduling).toBe('running')
})

test('rejects a second owner and releases ownership after close', async () => {
  const { engine, open, path, harnessOptions } = await setup()
  await expect(AgentEngine.open(path, harnessOptions, context())).rejects.toThrow(/locked/)
  await engine.close()
  await expect(open()).resolves.toBeInstanceOf(AgentEngine)
})

test('recovers committed in-flight work after a process is killed and releases its OS lock', async () => {
  const fixture = await mkdtemp(join(process.cwd(), 'node_modules', '.nook-recovery-'))
  try {
    const source = await readFile(new URL('./agent-engine.ts', import.meta.url), 'utf8')
    await writeFile(
      join(fixture, 'agent-engine.mjs'),
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
    )
    await writeFile(
      join(fixture, 'entry.mjs'),
      `
import { AgentEngine } from './agent-engine.mjs'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import { createRegistry } from '@earendil-works/pi-durable'
try {
  const recover = process.argv[3] === 'recover'
  const faux = fauxProvider({ tokensPerSecond: recover ? 10000 : 20, tokenSize: { min: 1, max: 1 } })
  faux.setResponses([fauxAssistantMessage(recover ? 'recovered' : 'unfinished '.repeat(100))])
  const models = createModels()
  models.setProvider(faux.provider)
  const engine = await AgentEngine.open(process.argv[2], { models, registry: createRegistry() }, context)
  await engine.create('crash-thread', { model: { provider: 'faux', modelId: 'faux-1' } }, context)
  const conversation = await engine.conversation('crash-thread', context)
  const submission = await conversation.submit({ type: 'input', content: 'Crash input', requestId: 'crash-request' }, context)
  if (recover) {
    const settled = await submission.wait(context)
    await conversation.waitForIdle(context)
    const entries = await conversation.entries({ order: 'ascending' }, 100, undefined, context)
    await engine.close()
    process.send({ status: settled.status, submissionId: submission.id, conversationId: conversation.id, users: entries.items.filter(entry => entry.kind === 'pi.user').length })
    process.disconnect()
  } else {
    const watch = await engine.watch('crash-thread', context)
    let sent = false
    watch.start(batch => {
      if (!sent && batch.some(event => event.type === 'message_update')) {
        sent = true
        process.send({ submissionId: submission.id, conversationId: conversation.id })
      }
    })
  }
} catch (error) {
  console.error(error)
  process.exit(1)
}
`,
    )
    const path = join(directory, 'crash.sqlite')
    const start = (mode: string) => {
      const child = fork(join(fixture, 'entry.mjs'), [path, mode], { silent: true })
      children.push(child)
      return child
    }
    const crashed = start('start')
    const [before] = await once(crashed, 'message', { signal: AbortSignal.timeout(15_000) })
    const competingModels = createModels()
    await expect(
      AgentEngine.open(path, { models: competingModels, registry: createRegistry() }, context()),
    ).rejects.toThrow(/locked/)
    const exited = once(crashed, 'exit')
    crashed.kill('SIGKILL')
    await exited
    const recovering = start('recover')
    const finished = once(recovering, 'exit')
    const [after] = await once(recovering, 'message', { signal: AbortSignal.timeout(15_000) })
    expect(after).toEqual({ ...before, status: 'done', users: 1 })
    expect((await finished)[0]).toBe(0)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}, 40_000)
