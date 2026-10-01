import { expect, test, vi } from 'vitest'

import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentRun } from '@/shared/agent/agentRun'
import type { AgentRuntime, AgentRuntimeFactory, AgentRuntimeInput, AgentRuntimeEvent } from './agentRuntime'
import { AgentService } from './agentService'
import type { AgentRunRepo } from '../db/repositories/agentRunRepo'
import type { AgentSessionRecord, AgentSessionRepo } from '../db/repositories/agentSessionRepo'
import type { AgentEventEnvelope } from './agentEventEnvelope'
import type { AgentExecutionRecordRepo } from '../db/repositories/agentExecutionRecordRepo'
import type { ArtifactRepo } from '../db/repositories/artifactRepo'
import type { Artifact } from '@/shared/artifact/artifact'
import type { DelegateTaskProgress } from '@/shared/agent/delegateTask'

class MemorySessionRepo implements AgentSessionRepo {
  constructor(private readonly records: AgentSessionRecord[]) {}

  async findAll() {
    return this.records
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id)
  }

  async save(session: AgentSessionRecord) {
    const index = this.records.findIndex((record) => record.id === session.id)
    if (index === -1) this.records.push(session)
    else this.records[index] = session
  }

  async delete(id: string) {
    const index = this.records.findIndex((record) => record.id === id)
    if (index !== -1) this.records.splice(index, 1)
  }
}

class MemoryRunRepo implements AgentRunRepo {
  readonly runs = new Map<string, AgentRun>()
  readonly savedStatuses: AgentRun['status'][] = []

  constructor(runs: AgentRun[] = []) {
    for (const run of runs) this.runs.set(run.id, { ...run })
  }

  async findAll() {
    return Array.from(this.runs.values()).sort((a, b) => a.createdAt - b.createdAt)
  }

  async findBySessionId(sessionId: string) {
    return Array.from(this.runs.values())
      .filter((run) => run.sessionId === sessionId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async save(run: AgentRun) {
    this.savedStatuses.push(run.status)
    this.runs.set(run.id, { ...run })
  }

  async markActiveAsInterrupted(interruptedAt: number) {
    for (const [id, run] of this.runs) {
      if (run.status === 'running' || run.status === 'waiting') {
        this.runs.set(id, {
          ...run,
          status: 'interrupted',
          updatedAt: interruptedAt,
          completedAt: interruptedAt,
        })
      }
    }
  }
}

class MemoryExecutionRecordRepo implements AgentExecutionRecordRepo {
  readonly records: AgentEventEnvelope[] = []

  async append(envelope: AgentEventEnvelope) {
    this.records.push(envelope)
  }

  async getMaxSeq(runId: string) {
    return Math.max(0, ...this.records.filter((record) => record.runId === runId).map((record) => record.seq))
  }

  async findByRunId(runId: string) {
    return this.records
      .filter((record) => record.runId === runId)
      .map((record, index) => ({ id: index + 1, ...record }))
  }
}

class MemoryArtifactRepo implements ArtifactRepo {
  readonly artifacts: Artifact[] = []

  async findById(id: string) {
    return this.artifacts.find((artifact) => artifact.id === id)
  }

  async findBySessionId(sessionId: string) {
    return this.artifacts.filter((artifact) => artifact.sessionId === sessionId)
  }

  async findByRunId(runId: string) {
    return this.artifacts.filter((artifact) => artifact.runId === runId)
  }

  async save(artifact: Artifact) {
    this.artifacts.push(artifact)
  }
}

const sessionRecord: AgentSessionRecord = {
  id: 'session-1',
  title: 'Test session',
  createdAt: 1,
  updatedAt: 1,
  archived: false,
}

function run(status: AgentRun['status'], id: string, createdAt: number): AgentRun {
  return {
    id,
    sessionId: sessionRecord.id,
    status,
    createdAt,
    updatedAt: createdAt,
    toolCalls: [],
    toolResults: [],
    artifactIds: [],
  }
}

test('initialize recovers active runs and restores run history', async () => {
  const runRepo = new MemoryRunRepo([
    run('running', 'running-run', 1),
    run('waiting', 'waiting-run', 2),
    run('completed', 'completed-run', 3),
  ])
  const runtimeFactory: AgentRuntimeFactory = {
    create() {
      throw new Error('runtime should not be created during recovery')
    },
  }
  const service = new AgentService(
    runtimeFactory,
    new MemorySessionRepo([sessionRecord]),
    runRepo,
    new MemoryExecutionRecordRepo(),
    new MemoryArtifactRepo(),
  )

  const stages: Array<[string, number]> = []
  await service.initialize((stage, count) => stages.push([stage, count]))

  expect(stages).toEqual([
    ['sessions_restored', 1],
    ['runs_restored', 3],
  ])

  const history = await service.listRuns(sessionRecord.id)
  expect(history.map(({ id, status }) => ({ id, status }))).toEqual([
    { id: 'completed-run', status: 'completed' },
    { id: 'waiting-run', status: 'interrupted' },
    { id: 'running-run', status: 'interrupted' },
  ])
  expect(service.getSession(sessionRecord.id)?.toSummary().activeRunId).toBeUndefined()
})

test('lists the latest run overview for every session', async () => {
  const idleSession: AgentSessionRecord = {
    id: 'session-2',
    title: 'Idle session',
    createdAt: 0,
    updatedAt: 0,
    archived: false,
  }
  const oldRun = { ...run('failed', 'old-run', 1), updatedAt: 2, completedAt: 2 }
  const latestRun = { ...run('completed', 'latest-run', 3), updatedAt: 4, completedAt: 4 }
  const service = new AgentService(
    { create: () => ({ run: async () => undefined, dispose() {} }) },
    new MemorySessionRepo([sessionRecord, idleSession]),
    new MemoryRunRepo([oldRun, latestRun]),
    new MemoryExecutionRecordRepo(),
    new MemoryArtifactRepo(),
  )

  await service.initialize()

  await expect(service.listRunOverviews()).resolves.toEqual([
    {
      sessionId: sessionRecord.id,
      sessionTitle: sessionRecord.title,
      runId: latestRun.id,
      status: 'completed',
      completedAt: latestRun.completedAt,
      updatedAt: latestRun.updatedAt,
    },
    {
      sessionId: idleSession.id,
      sessionTitle: idleSession.title,
      status: 'idle',
      updatedAt: idleSession.updatedAt,
    },
  ])
})

test('rejects steering when Pi has no active product run', async () => {
  const service = new AgentService(
    { create: () => ({ run: async () => undefined, dispose() {} }) },
    new MemorySessionRepo([sessionRecord]),
    new MemoryRunRepo(),
    new MemoryExecutionRecordRepo(),
    new MemoryArtifactRepo(),
  )
  await service.initialize()

  expect(() => service.steerRun(sessionRecord.id, 'follow up')).toThrow(
    'Pi runtime is active without an AgentRun',
  )
})

test('records steering against the run during its startup window', async () => {
  let finishRun: () => void = () => undefined
  const initialFinishRun = finishRun
  const executionRecordRepo = new MemoryExecutionRecordRepo()
  const service = new AgentService(
    {
      create: () => ({
        async run(_prompt, emit) {
          await new Promise<void>((resolve) => {
            finishRun = resolve
          })
          emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial', 'steer'] })
          emit({ type: 'pi_turn_end', result: 'committed' })
          emit({ type: 'agent_completed' })
        },
        dispose() {},
      }),
    },
    new MemorySessionRepo([sessionRecord]),
    new MemoryRunRepo(),
    executionRecordRepo,
    new MemoryArtifactRepo(),
  )
  await service.initialize()

  const handle = service.startRun(sessionRecord.id, { prompt: 'first' })
  service.steerRun(sessionRecord.id, 'second')
  await vi.waitFor(() => expect(finishRun).not.toBe(initialFinishRun))
  finishRun()
  await handle.completion

  expect(
    executionRecordRepo.records
      .filter(({ event }) => event.type === 'user_message')
      .map(({ event }) => (event.type === 'user_message' ? event.text : '')),
  ).toEqual(['first', 'second'])
})

test('persists a run before execution and serializes status changes', async () => {
  const runRepo = new MemoryRunRepo()
  const executionRecordRepo = new MemoryExecutionRecordRepo()
  const runtime: AgentRuntime = {
    async run(_input, emit: (event: AgentRuntimeEvent) => void) {
      expect(Array.from(runRepo.runs.values())[0]?.status).toBe('running')
      emit({ type: 'agent_started' })
      emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] })
      emit({
        type: 'approval_required',
        approvalId: 'approval-1',
        call: { id: 'tool-1', toolName: 'write', args: {} },
      })
      emit({ type: 'tool_started', call: { id: 'tool-1', toolName: 'write', args: {} } })
      emit({
        type: 'tool_finished',
        result: { toolCallId: 'tool-1', toolName: 'write', output: 'ok', success: true },
      })
      emit({ type: 'pi_turn_end', result: 'committed' })
      emit({ type: 'agent_completed' })
    },
    dispose() {},
  }
  const service = new AgentService(
    { create: () => runtime },
    new MemorySessionRepo([sessionRecord]),
    runRepo,
    executionRecordRepo,
    new MemoryArtifactRepo(),
  )
  await service.initialize()

  const published: AgentEventEnvelope[] = []
  service.subscribe((envelope) => published.push(envelope))
  const finalRun = await service.startRun(sessionRecord.id, { prompt: 'hello' }).completion

  expect(published).toEqual(executionRecordRepo.records)
  const sequences = published.map((envelope) => envelope.seq)
  expect(new Set(sequences).size).toBe(sequences.length)
  expect(sequences.every((seq, index) => index === 0 || seq > sequences[index - 1]!)).toBe(true)
  expect(published.find((envelope) => envelope.event.type === 'tool_started')).toMatchObject({ stepId: expect.any(String) })

  expect(finalRun.status).toBe('completed')
  expect(finalRun.completedAt).toBeDefined()
  expect(runRepo.savedStatuses).toEqual(['running', 'waiting', 'running', 'running', 'completed'])
  expect(runRepo.runs.get(finalRun.id)?.status).toBe('completed')
  expect(finalRun.toolCalls).toEqual([{ id: 'tool-1', toolName: 'write', args: {} }])
  expect(finalRun.toolResults).toEqual([
    { toolCallId: 'tool-1', toolName: 'write', output: 'ok', success: true },
  ])
  expect(
    (await service.listExecutionRecords(finalRun.id)).map((record) => record.event.type),
  ).toEqual([
    'user_message',
    'agent_started',
    'step_started',
    'approval_required',
    'tool_started',
    'tool_finished',
    'step_ended',
    'agent_completed',
  ])
})

test('turns a successful create_artifact tool call into a durable run artifact', async () => {
  const runRepo = new MemoryRunRepo()
  const artifactRepo = new MemoryArtifactRepo()
  const runtime: AgentRuntime = {
    async run(_prompt, emit) {
      emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] })
      emit({
        type: 'tool_started',
        call: {
          id: 'tool-artifact',
          toolName: 'create_artifact',
          args: { kind: 'markdown', title: 'Plan', content: '# Plan' },
        },
      })
      emit({
        type: 'tool_finished',
        result: {
          toolCallId: 'tool-artifact',
          toolName: 'create_artifact',
          output: 'created',
          success: true,
        },
      })
      emit({ type: 'pi_turn_end', result: 'committed' })
      emit({ type: 'agent_completed' })
    },
    dispose() {},
  }
  const service = new AgentService(
    { create: () => runtime },
    new MemorySessionRepo([sessionRecord]),
    runRepo,
    new MemoryExecutionRecordRepo(),
    artifactRepo,
  )
  await service.initialize()

  const finalRun = await service.startRun(sessionRecord.id, { prompt: 'create a plan' }).completion

  expect(artifactRepo.artifacts).toMatchObject([
    {
      sessionId: sessionRecord.id,
      runId: finalRun.id,
      toolCallId: 'tool-artifact',
      kind: 'markdown',
      title: 'Plan',
      content: '# Plan',
    },
  ])
  expect(finalRun.artifactIds).toEqual([artifactRepo.artifacts[0]!.id])
})

test('turns a successful update_plan tool call into a persisted run plan and event', async () => {
  const runRepo = new MemoryRunRepo()
  const executionRecordRepo = new MemoryExecutionRecordRepo()
  const plan = {
    steps: [
      { id: 'analyze', title: '分析项目', status: 'completed' as const },
      { id: 'edit', title: '修改实现', status: 'in_progress' as const },
    ],
  }
  const runtime: AgentRuntime = {
    async run(_input, emit) {
      emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] })
      emit({
        type: 'tool_started',
        call: { id: 'tool-plan', toolName: 'update_plan', args: plan },
      })
      emit({
        type: 'tool_finished',
        result: {
          toolCallId: 'tool-plan',
          toolName: 'update_plan',
          output: { content: [{ type: 'text', text: 'updated' }], details: plan },
          success: true,
        },
      })
      emit({ type: 'pi_turn_end', result: 'committed' })
      emit({ type: 'agent_completed' })
    },
    dispose() {},
  }
  const service = new AgentService(
    { create: () => runtime },
    new MemorySessionRepo([sessionRecord]),
    runRepo,
    executionRecordRepo,
    new MemoryArtifactRepo(),
  )
  await service.initialize()

  const finalRun = await service.startRun(sessionRecord.id, { prompt: '请执行复杂任务' }).completion

  expect(finalRun.plan).toEqual({
    steps: [
      { id: 'analyze', title: '分析项目', status: 'completed' },
      { id: 'edit', title: '修改实现', status: 'completed' },
    ],
  })
  expect(runRepo.runs.get(finalRun.id)?.plan).toEqual(finalRun.plan)
  expect(
    (await service.listExecutionRecords(finalRun.id)).map((record) => record.event.type),
  ).toEqual([
    'user_message',
    'step_started',
    'tool_started',
    'tool_finished',
    'plan_updated',
    'step_ended',
    'plan_updated',
    'agent_completed',
  ])
})

test('completes the active plan step when the agent run completes', async () => {
  const runRepo = new MemoryRunRepo()
  const plan = {
    steps: [
      { id: 'analyze', title: '分析项目', status: 'in_progress' as const },
      { id: 'edit', title: '修改实现', status: 'pending' as const },
    ],
  }
  const runtime: AgentRuntime = {
    async run(_input, emit) {
      emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] })
      emit({
        type: 'tool_started',
        call: { id: 'tool-plan', toolName: 'update_plan', args: plan },
      })
      emit({
        type: 'tool_finished',
        result: {
          toolCallId: 'tool-plan',
          toolName: 'update_plan',
          output: { content: [{ type: 'text', text: 'updated' }], details: plan },
          success: true,
        },
      })
      emit({ type: 'pi_turn_end', result: 'committed' })
      emit({ type: 'agent_completed' })
    },
    dispose() {},
  }
  const service = new AgentService(
    { create: () => runtime },
    new MemorySessionRepo([sessionRecord]),
    runRepo,
    new MemoryExecutionRecordRepo(),
    new MemoryArtifactRepo(),
  )
  await service.initialize()

  const finalRun = await service.startRun(sessionRecord.id, { prompt: '请完成复杂任务' }).completion

  expect(finalRun.plan).toEqual({
    steps: [
      { id: 'analyze', title: '分析项目', status: 'completed' },
      { id: 'edit', title: '修改实现', status: 'completed' },
    ],
  })
  expect(runRepo.runs.get(finalRun.id)?.plan).toEqual(finalRun.plan)
})

test('delegates an isolated child run and returns its result', async () => {
  const runRepo = new MemoryRunRepo()
  const childInputs: AgentRuntimeInput[] = []
  let parentStarted = false
  let releaseParent: () => void = () => undefined
  const parentRuntime: AgentRuntime = {
    async run(_input, emit) {
      emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] })
      parentStarted = true
      await new Promise<void>((resolve) => {
        releaseParent = resolve
      })
      emit({ type: 'pi_turn_end', result: 'committed' })
      emit({ type: 'agent_completed' })
    },
    dispose() {},
  }
  const childRuntime: AgentRuntime = {
    async run(input, emit) {
      emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] })
      childInputs.push(input)
      emit({ type: 'text_delta', text: 'child result' })
      emit({ type: 'pi_turn_end', result: 'committed' })
      emit({ type: 'agent_completed' })
    },
    dispose() {},
  }
  const runtimeFactory: AgentRuntimeFactory = {
    create(_sessionId, options) {
      return options?.persistState === false ? childRuntime : parentRuntime
    },
  }
  const service = new AgentService(
    runtimeFactory,
    new MemorySessionRepo([sessionRecord]),
    runRepo,
    new MemoryExecutionRecordRepo(),
    new MemoryArtifactRepo(),
    {
      buildChildContext: async () => ({
        attachments: [],
        memories: [
          {
            id: 'memory-1',
            scope: 'workspace',
            content: 'Use the test database',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    },
  )
  await service.initialize()

  const parent = service.startRun(sessionRecord.id, { prompt: 'parent task' })
  await vi.waitFor(() => expect(parentStarted).toBe(true))

  const progress: DelegateTaskProgress[] = []
  const result = await service.delegateTask(
    parent.run.id,
    {
      task: 'inspect the database',
      skillIds: ['database-review'],
      context: 'Only inspect the schema files.',
    },
    (update) => progress.push(update),
  )
  const child = service
    .getSession(sessionRecord.id)
    ?.getRuns()
    .find((run) => run.id === result.runId)

  expect(result).toMatchObject({
    runId: child?.id,
    status: 'completed',
    result: 'child result',
    name: child?.displayName,
    avatar: child?.avatar,
  })
  expect(child).toMatchObject({
    displayName: expect.any(String),
    avatar: expect.any(String),
    parentRunId: parent.run.id,
    rootRunId: parent.run.id,
    depth: 1,
    status: 'completed',
  })
  expect(childInputs[0]).toMatchObject({
    prompt:
      'inspect the database\n\nContext provided by the parent:\nOnly inspect the schema files.',
    skillIds: ['database-review'],
    context: { attachments: [], memories: [{ id: 'memory-1', content: 'Use the test database' }] },
  })
  expect(progress[0]).toMatchObject({
    runId: child?.id,
    name: child?.displayName,
    avatar: child?.avatar,
    task: 'inspect the database',
    status: 'running',
  })
  expect(progress.at(-1)).toMatchObject({
    runId: child?.id,
    name: child?.displayName,
    status: 'completed',
    summary: 'child result',
  })

  releaseParent()
  await expect(parent.completion).resolves.toMatchObject({ status: 'completed' })
  const parentRecords = await service.listExecutionRecords(parent.run.id)
  const childRecords = await service.listExecutionRecords(child!.id)
  expect(parentRecords[0]?.seq).toBe(1)
  expect(childRecords[0]?.seq).toBe(1)
  const parentStep = parentRecords.find((record) => record.event.type === 'step_started')
  const childStep = childRecords.find((record) => record.event.type === 'step_started')
  expect(childStep?.stepId).not.toBe(parentStep?.stepId)
})

test('limits child depth and concurrency and aborts children with the parent', async () => {
  const runRepo = new MemoryRunRepo()
  const waitForAbort = async (
    _input: AgentRuntimeInput,
    emit: (event: AgentEvent) => void,
    signal?: AbortSignal,
  ) => {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve()
      else signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    emit({ type: 'agent_aborted' })
  }
  const service = new AgentService(
    { create: () => ({ run: waitForAbort, dispose() {} }) },
    new MemorySessionRepo([sessionRecord]),
    runRepo,
    new MemoryExecutionRecordRepo(),
    new MemoryArtifactRepo(),
  )
  await service.initialize()

  const parent = service.startRun(sessionRecord.id, { prompt: 'parent task' })
  await vi.waitFor(() => expect(service.getSession(sessionRecord.id)?.getRuns()).toHaveLength(1))
  const first = service.delegateTask(parent.run.id, { task: 'first child' })
  await vi.waitFor(() =>
    expect(
      service
        .getSession(sessionRecord.id)
        ?.getRuns()
        .filter((run) => run.parentRunId === parent.run.id),
    ).toHaveLength(1),
  )
  const child = service
    .getSession(sessionRecord.id)
    ?.getRuns()
    .find((run) => run.parentRunId === parent.run.id)
  expect(child).toBeDefined()
  await expect(service.delegateTask(child!.id, { task: 'nested child' })).rejects.toThrow(
    'Subagent depth limit exceeded',
  )

  const second = service.delegateTask(parent.run.id, { task: 'second child' })
  await vi.waitFor(() =>
    expect(
      service
        .getSession(sessionRecord.id)
        ?.getRuns()
        .filter((run) => run.parentRunId === parent.run.id),
    ).toHaveLength(2),
  )
  await expect(service.delegateTask(parent.run.id, { task: 'third child' })).rejects.toThrow(
    'Maximum concurrent child runs reached',
  )

  service.abortSession(sessionRecord.id)

  await expect(first).resolves.toMatchObject({ status: 'failed' })
  await expect(second).resolves.toMatchObject({ status: 'failed' })
  await expect(parent.completion).resolves.toMatchObject({ status: 'aborted' })
  expect(
    service
      .getSession(sessionRecord.id)
      ?.getRuns()
      .filter((run) => run.parentRunId === parent.run.id)
      .every((run) => run.status === 'aborted'),
  ).toBe(true)
})

test.each(['aborted', 'failed'] as const)('persists active Step closure before agent_%s', async (status) => {
  const repo = new MemoryExecutionRecordRepo()
  const service = new AgentService(
    { create: () => ({
      async run(_input, emit) {
        emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] })
        emit({ type: 'thinking_delta', text: 'working' })
        if (status === 'failed') throw new Error('model failed')
        emit({ type: 'agent_aborted' })
      },
      dispose() {},
    }) },
    new MemorySessionRepo([sessionRecord]), new MemoryRunRepo(), repo, new MemoryArtifactRepo(),
  )
  await service.initialize()
  const finalRun = await service.startRun(sessionRecord.id, { prompt: 'start' }).completion
  expect(finalRun.status).toBe(status)
  expect(repo.records.slice(-2).map((record) => record.event)).toEqual([
    { type: 'step_ended', stepId: expect.any(String), result: 'aborted' },
    status === 'failed' ? { type: 'agent_failed', error: 'model failed' } : { type: 'agent_aborted' },
  ])
  expect(repo.records.at(-1)?.stepId).toBeUndefined()
})

test('creates a new Run after the previous runtime settles', async () => {
  const service = new AgentService(
    { create: () => ({
      async run(_input, emit) {
        emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] })
        emit({ type: 'pi_turn_end', result: 'committed' })
        emit({ type: 'agent_completed' })
      },
      dispose() {},
    }) },
    new MemorySessionRepo([sessionRecord]), new MemoryRunRepo(), new MemoryExecutionRecordRepo(), new MemoryArtifactRepo(),
  )
  await service.initialize()
  const first = await service.startRun(sessionRecord.id, { prompt: 'first' }).completion
  expect(service.getSession(sessionRecord.id)?.toSummary().activeRunId).toBeUndefined()
  const second = await service.startRun(sessionRecord.id, { prompt: 'second' }).completion
  expect(second.id).not.toBe(first.id)
  expect((await service.listExecutionRecords(first.id))[0]?.seq).toBe(1)
  expect((await service.listExecutionRecords(second.id))[0]?.seq).toBe(1)
})

test('keeps one Run open until Pi delivers steering, late inputs and follow-up into Steps', async () => {
  const repo = new MemoryExecutionRecordRepo()
  let releaseFirst: () => void = () => undefined
  let firstStarted = false
  const service = new AgentService(
    { create: () => ({
      async run(input, emit) {
        emit({ type: 'agent_started' })
        emit({ type: 'pi_turn_start', piTurnIndex: 0, deliveries: ['initial'] })
        firstStarted = true
        await new Promise<void>((resolve) => { releaseFirst = resolve })
        emit({ type: 'pi_turn_end', result: 'committed' })
        emit({ type: 'agent_completed' })
        expect(service.getSession(sessionRecord.id)?.toSummary().activeRunId).toBe(input.runId)
        emit({ type: 'pi_turn_start', piTurnIndex: 1, deliveries: ['steer', 'steer', 'steer'] })
        service.steerRun(sessionRecord.id, 'late')
        emit({ type: 'pi_turn_end', result: 'committed' })
        emit({ type: 'pi_turn_start', piTurnIndex: 2, deliveries: ['steer'] })
        emit({ type: 'pi_turn_end', result: 'committed' })
        emit({ type: 'agent_completed' })
        expect(service.getSession(sessionRecord.id)?.toSummary().activeRunId).toBe(input.runId)
        emit({ type: 'pi_turn_start', piTurnIndex: 3, deliveries: ['follow-up'] })
        emit({ type: 'text_delta', text: 'done' })
        emit({ type: 'pi_turn_end', result: 'committed' })
        emit({ type: 'pi_agent_settled' })
        emit({ type: 'agent_completed' })
      },
      dispose() {},
    }) },
    new MemorySessionRepo([sessionRecord]), new MemoryRunRepo(), repo, new MemoryArtifactRepo(),
  )
  await service.initialize()
  const handle = service.startRun(sessionRecord.id, { prompt: 'initial' })
  await vi.waitFor(() => expect(firstStarted).toBe(true))
  for (const text of ['a', 'b', 'c']) service.steerRun(sessionRecord.id, text)
  service.steerRun(sessionRecord.id, 'follow', 'follow-up')
  releaseFirst()
  await expect(handle.completion).resolves.toMatchObject({ status: 'completed' })
  const inputTexts = new Map(repo.records.flatMap(({ event }) => event.type === 'user_message' ? [[event.inputId, event.text] as const] : []))
  const steps = repo.records.flatMap(({ event }) => event.type === 'step_started' ? [event] : [])
  expect(steps.map((step) => [step.ordinal, step.acceptedInputIds.map((id) => inputTexts.get(id))])).toEqual([
    [1, ['initial']], [2, ['a', 'b', 'c']], [3, ['late']], [4, ['follow']],
  ])
  expect(new Set(repo.records.map((record) => record.runId))).toEqual(new Set([handle.run.id]))
  expect(repo.records.filter((record) => record.event.type === 'agent_completed')).toHaveLength(1)
  expect(repo.records.filter((record) => record.event.type === 'user_message').every((record) => record.stepId === undefined)).toBe(true)
})
