import { expect, test, vi } from 'vitest'

import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentRun } from '@/shared/agent/agentRun'
import type { AgentRuntime, AgentRuntimeFactory } from './agentRuntime'
import { AgentService } from './agentService'
import type { AgentRunRepo } from '../db/repositories/agentRunRepo'
import type { AgentSessionRecord, AgentSessionRepo } from '../db/repositories/agentSessionRepo'
import type { AgentEventEnvelope } from './agentEventEnvelope'
import type { AgentExecutionRecordRepo } from '../db/repositories/agentExecutionRecordRepo'
import type { ArtifactRepo } from '../db/repositories/artifactRepo'
import type { Artifact } from '@/shared/artifact/artifact'

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
    async run(_input, emit: (event: AgentEvent) => void) {
      expect(Array.from(runRepo.runs.values())[0]?.status).toBe('running')
      emit({ type: 'agent_started' })
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

  const finalRun = await service.startRun(sessionRecord.id, { prompt: 'hello' }).completion

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
    'approval_required',
    'tool_started',
    'tool_finished',
    'agent_completed',
  ])
})

test('turns a successful create_artifact tool call into a durable run artifact', async () => {
  const runRepo = new MemoryRunRepo()
  const artifactRepo = new MemoryArtifactRepo()
  const runtime: AgentRuntime = {
    async run(_prompt, emit) {
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
    'tool_started',
    'tool_finished',
    'plan_updated',
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
