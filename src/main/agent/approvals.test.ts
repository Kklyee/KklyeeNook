import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { Type } from 'typebox'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import { createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable'
import { AgentEngine } from './agent-engine'
import { AgentApprovals } from './approvals'

let directory: string
const engines: AgentEngine[] = []
const children: ChildProcess[] = []
const context = () => withAbortSignal(AbortSignal.timeout(15_000), BACKGROUND_CONTEXT)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-approvals-'))
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
  await rm(directory, { recursive: true, force: true })
})

async function setup() {
  const faux = fauxProvider()
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('write', { path: 'file' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('finished'),
  ])
  const models = createModels()
  models.setProvider(faux.provider)
  const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'written' }] }))
  const tool = defineTool({
    name: 'write', description: 'Write', parameters: Type.Object({ path: Type.String() }),
    replay: 'unsafe', execute,
  })
  const tools = defineExtension({ name: 'nook.tools', tools: [tool] })
  const registry = createRegistry()
  registry.install(tools)
  const open = async (
    request = { mode: 'full-access' },
    beforeResume?: (approvals: AgentApprovals) => Promise<unknown>,
  ) => {
    const approvals = new AgentApprovals(async () => ({ request, reason: 'write requires approval' }))
    registry.install(approvals.extension)
    const engine = await AgentEngine.open(
      join(directory, 'durable.sqlite'), { models, registry, settings: { retry: { enabled: false } } },
      context(), async (engine) => {
        approvals.connect(engine.harness)
        await beforeResume?.(approvals)
      },
    )
    engines.push(engine)
    return { engine, approvals }
  }
  const { engine, approvals } = await open()
  await engine.create('thread', {
    model: { provider: 'faux', modelId: 'faux-1' },
    tools: [tool], extensions: [tools, approvals.extension],
  }, context())
  const conversation = await engine.conversation('thread', context())
  const submission = await conversation.submit({ type: 'input', content: 'write', requestId: 'request' }, context())
  await vi.waitFor(async () => expect(await approvals.pending(conversation.id, context())).toHaveLength(1))
  const [request] = await approvals.pending(conversation.id, context())
  return { engine, approvals, open, execute, conversation, submission, request }
}

test('persists decisions, scopes them to the conversation and rejects contradictory duplicates', async () => {
  const { engine, approvals, execute, conversation, submission, request } = await setup()
  expect(execute).not.toHaveBeenCalled()
  await engine.create('other', {}, context())
  const other = await engine.conversation('other', context())
  await expect(approvals.decide(other.id, request.id, 'approved', context())).rejects.toThrow('not found')
  await Promise.all([
    approvals.decide(conversation.id, request.id, 'approved', context()),
    approvals.decide(conversation.id, request.id, 'approved', context()),
  ])
  await expect(approvals.decide(conversation.id, request.id, 'rejected', context())).rejects.toThrow('already decided')
  expect((await submission.wait(context())).status).toBe('done')
  await conversation.waitForIdle(context())
  expect(execute).toHaveBeenCalledTimes(1)
  expect(await approvals.pending(conversation.id, context())).toEqual([])
})

test('restores the same pending approval before unsafe execution intent after close and reopen', async () => {
  const { engine, open, execute, conversation, submission, request } = await setup()
  await engine.close()
  const restored = await open()
  expect(await restored.approvals.pending(conversation.id, context())).toEqual([request])
  expect(execute).not.toHaveBeenCalled()
  await restored.approvals.decide(conversation.id, request.id, 'approved', context())
  expect((await (await restored.engine.submission('thread', submission.id, context())).wait(context())).status).toBe('done')
  await (await restored.engine.conversation('thread', context())).waitForIdle(context())
  expect(execute).toHaveBeenCalledTimes(1)
})

test('an approved request remains bound to the exact tool arguments', async () => {
  const { approvals, conversation, request } = await setup()
  await approvals.decide(conversation.id, request.id, 'approved', context())
  const requirement = { request: request.request, reason: request.reason }
  const call = fauxToolCall(request.toolName, request.arguments, { id: request.callId })
  expect(await approvals.authorized(conversation.id, request.taskId, call, requirement, context())).toBe(true)
  expect(await approvals.authorized(conversation.id, request.taskId, { ...call, arguments: { path: 'different' } }, requirement, context())).toBe(false)
  expect(await approvals.authorized(conversation.id, request.taskId, { ...call, name: 'other' }, requirement, context())).toBe(false)
})

test('a rejected approval never executes the tool', async () => {
  const { approvals, execute, conversation, submission, request } = await setup()
  await approvals.decide(conversation.id, request.id, 'rejected', context())
  await submission.wait(context())
  await conversation.waitForIdle(context())
  expect(execute).not.toHaveBeenCalled()
  const entries = await conversation.entries({ order: 'ascending' }, 100, undefined, context())
  expect(JSON.stringify(entries.items)).toContain('用户拒绝本次执行')
})

test('cancellation removes pending approvals and rejects stale approval decisions', async () => {
  const { approvals, execute, conversation, request } = await setup()
  await conversation.abort(context())
  expect(await approvals.pending(conversation.id, context())).toEqual([])
  await expect(approvals.decide(conversation.id, request.id, 'approved', context())).rejects.toThrow('no longer active')
  expect(execute).not.toHaveBeenCalled()
})

test('changed authorization context cannot consume an old approved request', async () => {
  const { engine, open, execute, conversation, submission, request } = await setup()
  await engine.close()
  const restored = await open({ mode: 'workspace-write' }, (approvals) =>
    approvals.decide(conversation.id, request.id, 'approved', context()),
  )
  await (await restored.engine.submission('thread', submission.id, context())).wait(context())
  await (await restored.engine.conversation('thread', context())).waitForIdle(context())
  expect(execute).not.toHaveBeenCalled()
})

test.each(['waiting', 'executing'])('SIGKILL recovery preserves approval and unsafe replay policy (%s)', async (mode) => {
  const fixture = await mkdtemp(join(process.cwd(), 'node_modules', '.nook-approval-recovery-'))
  try {
    for (const name of ['agent-engine', 'approvals']) {
      const source = await readFile(new URL(`./${name}.ts`, import.meta.url), 'utf8')
      await writeFile(join(fixture, `${name}.mjs`), ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText)
    }
    await writeFile(join(fixture, 'entry.mjs'), `
import { appendFile } from 'node:fs/promises'
import { AgentEngine } from './agent-engine.mjs'
import { AgentApprovals } from './approvals.mjs'
import { BACKGROUND_CONTEXT as context, awaitWithContext } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import { createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable'
import { Type } from 'typebox'
try {
  const [path, mode, marker] = process.argv.slice(2)
  const recover = mode === 'recover'
  const faux = fauxProvider()
  faux.setResponses(recover ? [fauxAssistantMessage('recovered')] : [
    fauxAssistantMessage(fauxToolCall('write', { path: marker }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('finished'),
  ])
  const models = createModels()
  models.setProvider(faux.provider)
  const tool = defineTool({ name: 'write', description: 'Write', replay: 'unsafe', parameters: Type.Object({ path: Type.String() }),
    execute: async (args, api, ctx) => {
      await appendFile(args.path, 'effect\\n')
      if (!recover) {
        process.send({ stage: 'executing' })
        await awaitWithContext(new Promise(() => {}), ctx)
      }
      return { content: [{ type: 'text', text: 'written' }] }
    },
  })
  const tools = defineExtension({ name: 'nook.tools', tools: [tool] })
  const approvals = new AgentApprovals(async () => ({ request: { mode: 'full-access' }, reason: 'write requires approval' }))
  const registry = createRegistry()
  registry.install(tools)
  registry.install(approvals.extension)
  const engine = await AgentEngine.open(path, { models, registry }, context, engine => approvals.connect(engine.harness))
  await engine.create('thread', { model: { provider: 'faux', modelId: 'faux-1' }, tools: [tool], extensions: [tools, approvals.extension] }, context)
  const conversation = await engine.conversation('thread', context)
  const submission = await conversation.submit({ type: 'input', content: 'write', requestId: 'request' }, context)
  if (recover) {
    const pending = await approvals.pending(conversation.id, context)
    process.send({ stage: 'recovered', pending })
    if (pending.length) {
      const decision = await new Promise(resolve => process.once('message', resolve))
      await approvals.decide(conversation.id, decision.id, 'approved', context)
    }
    await submission.wait(context)
    await conversation.waitForIdle(context)
    const entries = await conversation.entries({ order: 'ascending' }, 100, undefined, context)
    await engine.close()
    process.send({ stage: 'finished', interrupted: JSON.stringify(entries.items).includes('may have partially run') })
    process.disconnect()
  } else {
    let request
    while (!request) {
      request = (await approvals.pending(conversation.id, context))[0]
      if (!request) await new Promise(resolve => setTimeout(resolve, 10))
    }
    if (mode === 'executing') await approvals.decide(conversation.id, request.id, 'approved', context)
    else process.send({ stage: 'waiting', request })
  }
} catch (error) {
  console.error(error)
  process.exit(1)
}
`)
    const path = join(directory, 'crash.sqlite')
    const marker = join(directory, 'effects.txt')
    const start = (mode: string) => {
      const child = fork(join(fixture, 'entry.mjs'), [path, mode, marker], { silent: true })
      children.push(child)
      return child
    }
    const child = start(mode)
    const [before] = await once(child, 'message', { signal: AbortSignal.timeout(15_000) })
    expect(before.stage).toBe(mode)
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    const restored = start('recover')
    const finished = once(restored, 'exit')
    const [after] = await once(restored, 'message', { signal: AbortSignal.timeout(15_000) })
    const result = once(restored, 'message', { signal: AbortSignal.timeout(15_000) })
    if (mode === 'waiting') {
      expect(after.pending).toEqual([before.request])
      restored.send({ id: before.request.id })
    } else expect(after.pending).toEqual([])
    expect((await result)[0]).toEqual({ stage: 'finished', interrupted: mode === 'executing' })
    expect((await finished)[0]).toBe(0)
    expect(await readFile(marker, 'utf8')).toBe('effect\n')
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}, 40_000)
