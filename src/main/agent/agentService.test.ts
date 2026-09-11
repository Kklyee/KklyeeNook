import { expect, test } from 'vitest'

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

  await service.initialize()

  const history = await service.listRuns(sessionRecord.id)
  expect(history.map(({ id, status }) => ({ id, status }))).toEqual([
    { id: 'completed-run', status: 'completed' },
    { id: 'waiting-run', status: 'interrupted' },
    { id: 'running-run', status: 'interrupted' },
  ])
  expect(service.getSession(sessionRecord.id)?.toSummary().activeRunId).toBeUndefined()
})

test('persists a run before execution and serializes status changes', async () => {
  const runRepo = new MemoryRunRepo()
  const executionRecordRepo = new MemoryExecutionRecordRepo()
  const runtime: AgentRuntime = {
    async run(_prompt: string, emit: (event: AgentEvent) => void) {
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

  const finalRun = await service.startRun(sessionRecord.id, 'hello').completion

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

  const finalRun = await service.startRun(sessionRecord.id, 'create a plan').completion

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
