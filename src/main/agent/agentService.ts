import type { PermissionMode } from '@/shared/approval/permission'
import { randomUUID } from 'node:crypto'

import type {
  AgentRuntime,
  AgentRuntimeFactory,
  AgentRuntimeFactoryOptions,
  AgentRuntimeInput,
  AgentRuntimeEvent,
} from './agentRuntime'
import { AgentSession } from './agentSession'
import { completePlanSteps, parseAgentPlan } from '@/shared/agent/agentPlan'
import type { AgentRun, AgentRunOverview } from '@/shared/agent/agentRun'
import type {
  DelegateTaskInput,
  DelegateTaskProgress,
  DelegateTaskResult,
  SubagentAvatar,
} from '@/shared/agent/delegateTask'
import { SUBAGENT_AVATARS } from '@/shared/agent/delegateTask'
import type { AgentRunContext } from '@/main/context/contextBuilder'
import { getAgentRunPatch } from './agentRunState'
import { ExecutionSequencer } from './executionSequencer'
import { ExecutionBoundaryTracker } from './executionBoundaryTracker'
import type { InputDelivery } from '@/shared/agent/agentEvent'

import { AgentEventEnvelope } from './agentEventEnvelope'
import { AgentEvent } from '@/shared/agent/agentEvent'
import { AgentSessionSummary } from '@/shared/agent/agentSession'
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

export interface AgentRunStartOptions {
  displayName?: string
  avatar?: SubagentAvatar
  parentRunId?: string
  rootRunId?: string
  depth?: number
  runtimeSessionId?: string
  parentRuntimeSessionId?: string
  ephemeralRuntime?: boolean
}

export interface AgentServiceOptions {
  buildChildContext?: (sessionId: string) => Promise<AgentRunContext | undefined>
  onRunFinished?: (runId: string) => Promise<void>
}

const MAX_CHILD_DEPTH = 1
const MAX_CONCURRENT_CHILDREN_PER_RUN = 2
const activeStatuses = new Set<AgentRun['status']>(['created', 'running', 'waiting'])
const subagentNameAdjectives = ['星河', '青禾', '松针', '白鹭', '云杉', '霜叶']
const subagentNameRoles = ['分析员', '检查员', '执行员', '整理员', '探路者']

function createSubagentName(): string {
  const adjective =
    subagentNameAdjectives[Math.floor(Math.random() * subagentNameAdjectives.length)] ?? '星河'
  const role = subagentNameRoles[Math.floor(Math.random() * subagentNameRoles.length)] ?? '分析员'
  return `${adjective}${role}`
}

function createSubagentAvatar(): SubagentAvatar {
  return SUBAGENT_AVATARS[Math.floor(Math.random() * SUBAGENT_AVATARS.length)] ?? '🦊'
}

function getDelegateTaskEventSummary(event: AgentEvent): string | undefined {
  switch (event.type) {
    case 'agent_started':
      return '子 Agent 已开始执行'
    case 'thinking_delta': {
      const text = event.text.trim()
      return text ? `思考：${text.slice(-160)}` : undefined
    }
    case 'text_delta': {
      const text = event.text.trim()
      return text ? text.slice(-160) : undefined
    }
    case 'tool_started':
      return `正在使用 ${event.call.toolName}`
    case 'tool_finished':
      return event.result.status === 'success'
        ? `已完成 ${event.result.toolName}`
        : `${event.result.toolName} 执行失败`
    case 'approval_required':
      return '等待审批'
    case 'context_compaction_started':
      return '正在整理上下文'
    default:
      return undefined
  }
}

export type AgentServiceInitializationStage = 'sessions_restored' | 'runs_restored'

export class AgentService {
  private readonly sessions = new Map<string, AgentSession>()
  private readonly runtimes = new Map<string, AgentRuntime>()
  private readonly listeners = new Set<AgentEventListener>()
  private readonly runPersistence = new Map<string, Promise<void>>()
  private readonly runControllers = new Map<string, AbortController>()
  private readonly childReservations = new Map<string, number>()
  private readonly sequencer = new ExecutionSequencer()
  private readonly boundaries = new Map<string, ExecutionBoundaryTracker>()

  constructor(
    private readonly runtimeFactory: AgentRuntimeFactory,
    private readonly sessionRepo: AgentSessionRepo,
    private readonly runRepo: AgentRunRepo,
    private readonly executionRecordRepo: AgentExecutionRecordRepo,
    private readonly artifactRepo: ArtifactRepo,
    private readonly options: AgentServiceOptions = {},
  ) {}

  async initialize(
    onStage?: (stage: AgentServiceInitializationStage, count: number) => void,
  ): Promise<void> {
    await this.runRepo.markActiveAsInterrupted(Date.now())
    const records = await this.sessionRepo.findAll()

    for (const record of records) {
      const { id, title, createdAt, updatedAt, archived, workspaceId, permissionMode } = record
      const session = new AgentSession(id, title, { createdAt, updatedAt, archived, workspaceId, permissionMode })
      this.sessions.set(id, session)
    }
    onStage?.('sessions_restored', records.length)

    const runs = await this.runRepo.findAll()
    for (const run of runs) {
      this.sessions.get(run.sessionId)?.restoreRun(run)
      this.sequencer.restore(run.id, await this.executionRecordRepo.getMaxSeq(run.id))
    }
    onStage?.('runs_restored', runs.length)
  }
  async createSession(title?: string, workspaceId: string | null = null): Promise<AgentSessionSummary> {
    const session = new AgentSession(randomUUID(), title)
    session.workspaceId = workspaceId
    await this.sessionRepo.save(session.toRecord())
    this.sessions.set(session.id, session)
    return session.toSummary()
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<AgentSessionSummary> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('会话不存在')
    if (session.toSummary().activeRunId) throw new Error('请等待当前 Agent 运行结束后再修改权限')
    session.permissionMode = mode
    session.touch()
    await this.sessionRepo.save(session.toRecord())
    this.runtimes.get(sessionId)?.dispose()
    this.runtimes.delete(sessionId)
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

  steerRun(sessionId: string, text: string, delivery: Exclude<InputDelivery, 'initial'> = 'steer'): string {
    const session = this.sessions.get(sessionId)
    const runId = session?.toSummary().activeRunId
    if (!session) throw new Error(`AgentSession not found: ${sessionId}`)
    if (!runId) {
      throw new Error(`Pi runtime is active without an AgentRun for session: ${sessionId}`)
    }
    const inputId = randomUUID()
    this.boundaries.get(runId)!.enqueue({ inputId, delivery })
    this.handleAgentEvent(session, runId, { type: 'user_message', inputId, delivery, text })
    return inputId
  }

  discardPendingInputs(sessionId: string, inputId?: string): void {
    const runId = this.sessions.get(sessionId)?.toSummary().activeRunId
    if (runId) this.boundaries.get(runId)?.discard(inputId)
  }

  abortSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    for (const run of session.getRuns()) {
      if (activeStatuses.has(run.status)) this.abortRun(run.id)
    }
  }

  abortRun(runId: string): void {
    if (!this.findRun(runId)) return
    this.runControllers.get(runId)?.abort()
    this.abortDescendants(runId)
  }

  getSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
  }

  async listSessions(): Promise<AgentSessionSummary[]> {
    return Array.from(this.sessions.values())
      .map((session) => session.toSummary())
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async listRunOverviews(): Promise<AgentRunOverview[]> {
    return Array.from(this.sessions.values())
      .map((session) => {
        const latestRun = session.getRuns().reduce<AgentRun | undefined>((latest, run) => {
          if (!latest) return run
          if (run.updatedAt !== latest.updatedAt) {
            return run.updatedAt > latest.updatedAt ? run : latest
          }
          return run.createdAt > latest.createdAt ? run : latest
        }, undefined)

        if (!latestRun) {
          return {
            sessionId: session.id,
            sessionTitle: session.title,
            status: 'idle' as const,
            updatedAt: session.updatedAt,
          }
        }

        return {
          sessionId: session.id,
          sessionTitle: session.title,
          runId: latestRun.id,
          ...(latestRun.scheduledTaskId ? { scheduledTaskId: latestRun.scheduledTaskId } : {}),
          status: latestRun.status,
          ...(latestRun.startedAt !== undefined ? { startedAt: latestRun.startedAt } : {}),
          ...(latestRun.completedAt !== undefined ? { completedAt: latestRun.completedAt } : {}),
          updatedAt: latestRun.updatedAt,
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async prompt(sessionId: string, input: AgentRuntimeInput): Promise<AgentRun> {
    const handle = this.startRun(sessionId, input)

    return handle.completion
  }

  private handleAgentEvent(session: AgentSession, runId: string, event: AgentEvent): void {
    const run = session.getRun(runId)
    if (!run) {
      return
    }
    const boundary = this.boundaries.get(runId)
    if (event.type === 'agent_completed' && boundary && !boundary.canSettleRun()) return
    if (event.type === 'agent_failed' || event.type === 'agent_aborted') boundary?.terminate()
    if (event.type === 'agent_completed' && run.plan) {
      const plan = completePlanSteps(run.plan)
      if (plan !== run.plan) this.handleAgentEvent(session, runId, { type: 'plan_updated', plan })
    }
    const timestamp = Date.now()
    const envelope: AgentEventEnvelope = {
      sessionId: session.id,
      runId,
      seq: this.sequencer.next(runId),
      ...boundary?.correlation,
      timestamp,
      event,
    }
    if (event.type === 'user_message') {
      delete envelope.stepId
    }
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

    if (event.type === 'agent_aborted') this.abortDescendants(runId)

    if (
      event.type === 'tool_finished' &&
      event.result.status === 'success' &&
      event.result.toolName === 'update_plan'
    ) {
      const call = run.toolCalls.find(({ id }) => id === event.result.toolCallId)
      const plan = parseAgentPlan(event.result.details ?? call?.args)
      if (plan) this.handleAgentEvent(session, runId, { type: 'plan_updated', plan })
    }

    if (
      event.type === 'tool_finished' &&
      event.result.status === 'success' &&
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
      workspaceId: session.getRun(runId)?.workspaceId ?? null,
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

  async delegateTask(
    parentRunId: string,
    input: DelegateTaskInput,
    onProgress?: (progress: DelegateTaskProgress) => void,
  ): Promise<DelegateTaskResult> {
    const parentLocation = this.findRun(parentRunId)
    if (!parentLocation) throw new Error(`AgentRun not found: ${parentRunId}`)

    const parent = parentLocation.run
    const depth = parent.depth ?? 0
    if (depth >= MAX_CHILD_DEPTH) {
      throw new Error('Subagent depth limit exceeded')
    }
    if (!activeStatuses.has(parent.status)) {
      throw new Error('Cannot delegate from an inactive AgentRun')
    }

    const activeChildren = parentLocation.session
      .getRuns()
      .filter((run) => run.parentRunId === parentRunId && activeStatuses.has(run.status)).length
    const reservations = this.childReservations.get(parentRunId) ?? 0
    if (activeChildren + reservations >= MAX_CONCURRENT_CHILDREN_PER_RUN) {
      throw new Error('Maximum concurrent child runs reached')
    }

    this.childReservations.set(parentRunId, reservations + 1)
    let reservationHeld = true
    try {
      const context = await this.options.buildChildContext?.(parent.sessionId)
      const task = input.task.trim()
      if (!task) throw new Error('Task is required')
      const explicitContext = input.context?.trim()
      const prompt = explicitContext
        ? `${task}\n\nContext provided by the parent:\n${explicitContext}`
        : task
      const displayName = createSubagentName()
      const avatar = createSubagentAvatar()
      let childRunId: string | undefined
      const unsubscribe = onProgress
        ? this.subscribe(({ runId, event }) => {
            if (runId !== childRunId) return
            const summary = getDelegateTaskEventSummary(event)
            if (!summary) return
            onProgress({ runId, name: displayName, avatar, task, status: 'running', summary })
          })
        : undefined
      const handle = this.startRun(
        parent.sessionId,
        {
          prompt,
          ...(context ? { context } : {}),
          ...(input.skillIds?.length ? { skillIds: [...new Set(input.skillIds)] } : {}),
        },
        undefined,
        {
          displayName,
          avatar,
          parentRunId,
          rootRunId: parent.rootRunId ?? parent.id,
          depth: depth + 1,
          runtimeSessionId: randomUUID(),
          parentRuntimeSessionId: parent.sessionId,
          ephemeralRuntime: true,
        },
      )
      childRunId = handle.run.id
      onProgress?.({
        runId: handle.run.id,
        name: displayName,
        avatar,
        task,
        status: 'running',
        summary: '子 Agent 已启动',
      })
      this.releaseChildReservation(parentRunId)
      reservationHeld = false

      try {
        const child = await handle.completion
        const status = child.status === 'completed' ? 'completed' : 'failed'
        const result = {
          runId: child.id,
          status,
          name: displayName,
          avatar,
          ...(child.result !== undefined ? { result: child.result } : {}),
          ...(child.artifactIds.length ? { artifactIds: child.artifactIds } : {}),
        } satisfies DelegateTaskResult
        const progressStatus = child.status === 'aborted' ? 'aborted' : status
        onProgress?.({
          runId: child.id,
          name: displayName,
          avatar,
          task,
          status: progressStatus,
          summary: child.result ?? child.error ?? '子 Agent 已完成',
        })
        return result
      } finally {
        unsubscribe?.()
      }
    } finally {
      if (reservationHeld) this.releaseChildReservation(parentRunId)
    }
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

  startRun(
    sessionId: string,
    input: AgentRuntimeInput,
    signal?: AbortSignal,
    options?: AgentRunStartOptions,
  ): AgentRunHandle {
    return this.startRunWithOptions(sessionId, input, signal, options)
  }

  private startRunWithOptions(
    sessionId: string,
    input: AgentRuntimeInput,
    signal?: AbortSignal,
    options: AgentRunStartOptions = {},
  ): AgentRunHandle {
    const session = this.getSession(sessionId)

    if (!session) {
      throw new Error(`AgentSession not found: ${sessionId}`)
    }

    const parent = options.parentRunId ? this.findRun(options.parentRunId)?.run : undefined
    if (options.parentRunId && (!parent || parent.sessionId !== sessionId)) {
      throw new Error(`Parent AgentRun not found: ${options.parentRunId}`)
    }

    const now = Date.now()
    const id = randomUUID()
    const runtimeSessionId = options.runtimeSessionId ?? sessionId
    const controller = new AbortController()
    const removeSignalListeners = [
      linkAbortSignal(signal, controller),
      linkAbortSignal(
        options.parentRunId ? this.runControllers.get(options.parentRunId)?.signal : undefined,
        controller,
      ),
    ]
    this.runControllers.set(id, controller)
    const run: AgentRun = {
      id,
      sessionId,
      workspaceId: session.workspaceId,
      ...(options.displayName ? { displayName: options.displayName } : {}),
      ...(options.avatar ? { avatar: options.avatar } : {}),
      ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
      rootRunId: options.rootRunId ?? parent?.rootRunId ?? parent?.id ?? id,
      depth: options.depth ?? (parent ? (parent.depth ?? 0) + 1 : 0),
      ...(input.scheduledTaskId ? { scheduledTaskId: input.scheduledTaskId } : {}),
      status: 'running',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      toolCalls: [],
      toolResults: [],
      artifactIds: [],
    }
    session.addRun(run)
    this.sequencer.restore(run.id, 0)
    const boundary = new ExecutionBoundaryTracker((event) => this.handleAgentEvent(session, run.id, event))
    this.boundaries.set(run.id, boundary)
    const initialSave = this.queueRunSave(run)
    const inputId = randomUUID()
    boundary.enqueue({ inputId, delivery: 'initial' })
    this.handleAgentEvent(session, run.id, { type: 'user_message', inputId, delivery: 'initial', text: input.prompt })
    const completion = initialSave.then(() =>
      this.executeRun(
        session,
        run.id,
        { ...input, runId: run.id },
        controller.signal,
        runtimeSessionId,
        options.ephemeralRuntime ?? runtimeSessionId !== sessionId,
        options.parentRuntimeSessionId,
      ),
    )

    void completion.then(
      () => {
        this.runPersistence.delete(run.id)
        this.runControllers.delete(run.id)
        this.boundaries.delete(run.id)
        for (const remove of removeSignalListeners) remove()
      },
      () => {
        this.runPersistence.delete(run.id)
        this.runControllers.delete(run.id)
        this.boundaries.delete(run.id)
        for (const remove of removeSignalListeners) remove()
      },
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
    input: AgentRuntimeInput,
    signal?: AbortSignal,
    runtimeSessionId = session.id,
    ephemeralRuntime = false,
    parentRuntimeSessionId?: string,
  ): Promise<AgentRun> {
    const runtime = this.getOrCreateRuntime(runtimeSessionId, {
      runtimeSessionId,
      permissionSessionId: session.id,
      persistState: !ephemeralRuntime,
      ...(parentRuntimeSessionId ? { parentRuntimeSessionId } : {}),
    })
    try {
      await runtime.run(
        input,
        (event) => {
          this.handleRuntimeEvent(session, runId, event)
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
    } finally {
      if (ephemeralRuntime) {
        runtime.dispose()
        this.runtimes.delete(runtimeSessionId)
      }
      try {
        await this.options.onRunFinished?.(runId)
      } catch (error) {
        console.error('Run cleanup failed', error)
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

  private getOrCreateRuntime(
    sessionId: string,
    options?: AgentRuntimeFactoryOptions,
  ): AgentRuntime {
    const existing = this.runtimes.get(sessionId)

    if (existing) {
      console.log('[AgentService] reuse runtime', { sessionId })
      return existing
    }
    console.log('[AgentService] create runtime', { sessionId })
    const runtime = this.runtimeFactory.create(sessionId, options)
    this.runtimes.set(sessionId, runtime)
    return runtime
  }

  private handleRuntimeEvent(session: AgentSession, runId: string, event: AgentRuntimeEvent): void {
    const boundary = this.boundaries.get(runId)!
    switch (event.type) {
      case 'pi_turn_start':
        boundary.onPiTurnStart(event.piTurnIndex, event.deliveries)
        return
      case 'pi_turn_end':
        boundary.onPiTurnEnd(event.result)
        return
      case 'pi_agent_settled':
        return
      default:
        this.handleAgentEvent(session, runId, event)
    }
  }

  private findRun(runId: string): { session: AgentSession; run: AgentRun } | undefined {
    for (const session of this.sessions.values()) {
      const run = session.getRun(runId)
      if (run) return { session, run }
    }
    return undefined
  }

  private abortDescendants(parentRunId: string): void {
    for (const session of this.sessions.values()) {
      for (const run of session.getRuns()) {
        if (run.parentRunId !== parentRunId || !activeStatuses.has(run.status)) continue
        this.runControllers.get(run.id)?.abort()
        this.abortDescendants(run.id)
      }
    }
  }

  private releaseChildReservation(parentRunId: string): void {
    const reservations = this.childReservations.get(parentRunId) ?? 0
    if (reservations <= 1) this.childReservations.delete(parentRunId)
    else this.childReservations.set(parentRunId, reservations - 1)
  }
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined
  const abort = () => target.abort()
  if (source.aborted) target.abort()
  else source.addEventListener('abort', abort, { once: true })
  return () => source.removeEventListener('abort', abort)
}
