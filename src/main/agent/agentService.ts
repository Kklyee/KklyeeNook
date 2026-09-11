import { randomUUID } from 'node:crypto'

import type { AgentRuntime } from './agentRuntime'
import { AgentSession } from './agentSession'
import { AgentRun } from '@/shared/agent/agentRun'
import { getAgentRunPatch } from './agentRunState'

import { AgentEventEnvelope } from './agentEventEnvelope'
import { AgentEvent } from '@/shared/agent/agentEvent'
import { AgentSessionSummary } from '@/shared/agent/agentSession'
import type { AgentRuntimeFactory } from './agentRuntime'
import { AgentSessionRepo } from '../db/repositories/agentSessionRepo'
import { AgentRunRepo } from '../db/repositories/agentRunRepo'
import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import type { AgentExecutionRecordRepo } from '../db/repositories/agentExecutionRecordRepo'
import type { ArtifactRepo } from '../db/repositories/artifactRepo'
import { parseArtifactDraft, type Artifact, type ArtifactDraft } from '@/shared/artifact/artifact'

export interface AgentRunHandle {
  run: AgentRun
  completion: Promise<AgentRun>
}
type AgentEventListener = (envelope: AgentEventEnvelope) => void

export class AgentService {
  private readonly sessions = new Map<string, AgentSession>()
  private readonly runtimes = new Map<string, AgentRuntime>()
  private readonly listeners = new Set<AgentEventListener>()
  private readonly runPersistence = new Map<string, Promise<void>>()

  constructor(
    private readonly runtimeFactory: AgentRuntimeFactory,
    private readonly sessionRepo: AgentSessionRepo,
    private readonly runRepo: AgentRunRepo,
    private readonly executionRecordRepo: AgentExecutionRecordRepo,
    private readonly artifactRepo: ArtifactRepo,
  ) {}

  async initialize(): Promise<void> {
    await this.runRepo.markActiveAsInterrupted(Date.now())
    const records = await this.sessionRepo.findAll()

    for (const record of records) {
      const { id, title, createdAt, updatedAt, archived } = record
      const session = new AgentSession(id, title, { createdAt, updatedAt, archived })
      this.sessions.set(id, session)
    }

    const runs = await this.runRepo.findAll()
    for (const run of runs) {
      this.sessions.get(run.sessionId)?.restoreRun(run)
    }
  }
  async createSession(title?: string): Promise<AgentSessionSummary> {
    const session = new AgentSession(randomUUID(), title)
    await this.sessionRepo.save(session.toRecord())
    this.sessions.set(session.id, session)
    return session.toSummary()
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId)
  }

  async renameSession(sessionId: string, newTitle: string): Promise<AgentSessionSummary> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`AgentSession not found: ${sessionId}`)
    }
    session.rename(newTitle)
    await this.sessionRepo.save(session.toRecord())

    return session.toSummary()
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`AgentSession not found: ${sessionId}`)
    }
    await this.sessionRepo.delete(sessionId)
    const runtime = this.runtimes.get(sessionId)
    if (runtime) {
      runtime.dispose()
      this.runtimes.delete(sessionId)
    }

    this.sessions.delete(sessionId)
  }

  async setSessionArchived(sessionId: string, archived: boolean): Promise<AgentSessionSummary> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`AgentSession not found: ${sessionId}`)
    session.setArchived(archived)
    await this.sessionRepo.save(session.toRecord())
    return session.toSummary()
  }

  steerRun(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId)
    const runId = session?.toSummary().activeRunId
    if (!session) throw new Error(`AgentSession not found: ${sessionId}`)
    if (!runId) {
      throw new Error(`Pi runtime is active without an AgentRun for session: ${sessionId}`)
    }
    this.handleAgentEvent(session, runId, { type: 'user_message', text })
  }

  getSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
  }

  async listSessions(): Promise<AgentSessionSummary[]> {
    return Array.from(this.sessions.values())
      .map((session) => session.toSummary())
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private getOrCreateRuntime(sessionId: string): AgentRuntime {
    const existing = this.runtimes.get(sessionId)

    if (existing) {
      console.log('[AgentService] reuse runtime', { sessionId })
      return existing
    }
    console.log('[AgentService] create runtime', { sessionId })
    const runtime = this.runtimeFactory.create(sessionId)
    this.runtimes.set(sessionId, runtime)
    return runtime
  }
  async prompt(sessionId: string, prompt: string): Promise<AgentRun> {
    const handle = this.startRun(sessionId, prompt)

    return handle.completion
  }

  private handleAgentEvent(session: AgentSession, runId: string, event: AgentEvent): void {
    const run = session.getRun(runId)
    if (!run) {
      return
    }
    const timestamp = Date.now()
    const envelope = { sessionId: session.id, runId, timestamp, event }
    const patch = getAgentRunPatch(run, event, timestamp)
    let updatedRun: AgentRun | undefined
    if (patch) {
      updatedRun = session.updateRun(runId, { ...patch, updatedAt: timestamp })
    }
    void this.queuePersistence(runId, async () => {
      if (event.type === 'artifact_created') await this.artifactRepo.save(event.artifact)
      await this.executionRecordRepo.append(envelope)
      if (updatedRun) await this.runRepo.save(updatedRun)
    }).catch((error) => {
      console.error('[AgentService] failed to persist execution event:', error)
    })
    this.publish(envelope)

    if (
      event.type === 'tool_finished' &&
      event.result.success &&
      event.result.toolName === 'create_artifact'
    ) {
      const call = run.toolCalls.find(({ id }) => id === event.result.toolCallId)
      const draft = parseArtifactDraft(call?.args)
      if (draft) this.createArtifact(session, runId, draft, event.result.toolCallId)
    }
  }

  addArtifact(
    sessionId: string,
    runId: string,
    draft: ArtifactDraft,
    toolCallId?: string,
  ): Artifact {
    const session = this.sessions.get(sessionId)
    if (!session?.getRun(runId)) throw new Error(`AgentRun not found: ${runId}`)
    return this.createArtifact(session, runId, draft, toolCallId)
  }

  private createArtifact(
    session: AgentSession,
    runId: string,
    draft: ArtifactDraft,
    toolCallId?: string,
  ): Artifact {
    const artifact: Artifact = {
      ...draft,
      id: randomUUID(),
      sessionId: session.id,
      runId,
      toolCallId,
      createdAt: Date.now(),
    }
    this.handleAgentEvent(session, runId, { type: 'artifact_created', artifact })
    return artifact
  }

  async listRuns(sessionId: string): Promise<AgentRun[]> {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`AgentSession not found: ${sessionId}`)
    }

    const pendingWrites = this.sessions
      .get(sessionId)!
      .getRuns()
      .map((run) => this.runPersistence.get(run.id))
      .filter((write): write is Promise<void> => write !== undefined)

    await Promise.all(pendingWrites)
    return this.runRepo.findBySessionId(sessionId)
  }

  async listExecutionRecords(runId: string): Promise<AgentExecutionRecord[]> {
    const pendingWrite = this.runPersistence.get(runId)
    if (pendingWrite) await pendingWrite
    return this.executionRecordRepo.findByRunId(runId)
  }
  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish(envelope: AgentEventEnvelope): void {
    for (const listener of this.listeners) {
      try {
        listener(envelope)
      } catch (error) {
        console.error('[AgentService] listener failed:', error)
      }
    }
  }

  startRun(sessionId: string, prompt: string, signal?: AbortSignal): AgentRunHandle {
    const session = this.getSession(sessionId)

    if (!session) {
      throw new Error(`AgentSession not found: ${sessionId}`)
    }

    const now = Date.now()
    const run: AgentRun = {
      id: randomUUID(),
      sessionId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      toolCalls: [],
      toolResults: [],
      artifactIds: [],
    }
    session.addRun(run)
    const initialSave = this.queueRunSave(run)
    this.handleAgentEvent(session, run.id, { type: 'user_message', text: prompt })
    const completion = initialSave.then(() => this.executeRun(session, run.id, prompt, signal))

    void completion.then(
      () => this.runPersistence.delete(run.id),
      () => this.runPersistence.delete(run.id),
    )

    return { run, completion }
  }

  private queueRunSave(run: AgentRun): Promise<void> {
    return this.queuePersistence(run.id, () => this.runRepo.save(run))
  }

  private queuePersistence(runId: string, operation: () => Promise<void>): Promise<void> {
    const previousWrite = this.runPersistence.get(runId) ?? Promise.resolve()
    const nextWrite = previousWrite.then(operation)
    this.runPersistence.set(runId, nextWrite)
    return nextWrite
  }

  private async executeRun(
    session: AgentSession,
    runId: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<AgentRun> {
    const runtime = this.getOrCreateRuntime(session.id)
    try {
      await runtime.run(
        prompt,
        (event) => {
          this.handleAgentEvent(session, runId, event)
        },
        signal,
      )
    } catch (error) {
      const run = session.getRun(runId)
      if (
        run &&
        run.status !== 'completed' &&
        run.status !== 'failed' &&
        run.status !== 'aborted'
      ) {
        this.handleAgentEvent(session, runId, {
          type: 'agent_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const pendingWrite = this.runPersistence.get(runId)
    if (pendingWrite) {
      await pendingWrite
    }

    const finalRun = session.getRun(runId)

    if (!finalRun) {
      throw new Error(`AgentRun not found: ${runId}`)
    }

    return finalRun
  }
}
