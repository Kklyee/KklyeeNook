import { randomUUID } from 'node:crypto'
import type { UpdateAgentModelSelectionRequest } from '@/shared/agent/agentSettings'
import type { AgentEventEnvelope } from '@/shared/agent/agentExecutionRecord'

import type {
  AgentBackendInfo,
  AgentBackendInitOptions,
  AgentBackendRequest,
  AgentBackendStatus,
  AgentBackendNotification,
  AgentBackendStartupStage,
  AgentBackendToMainMessage,
  MainToAgentBackendMessage,
} from './protocol'

const DEFAULT_START_TIMEOUT_MS = 45_000

export interface UtilityProcessLike {
  on(event: 'message', listener: (message: unknown) => void): unknown
  once(event: 'spawn', listener: () => void): unknown
  once(event: 'exit', listener: (code: number) => void): unknown
  once(event: 'error', listener: (type: 'FatalError', location: string, report: string) => void): unknown
  postMessage(message: unknown): void
  kill(): boolean
  pid?: number
}

export type UtilityProcessFactory = (entryPath: string) => UtilityProcessLike

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class AgentBackendProcess {
  private child: UtilityProcessLike | undefined
  private status: AgentBackendStatus = { state: 'starting' }
  private readonly statusListeners = new Set<(status: AgentBackendStatus) => void>()
  private readonly notificationListeners = new Set<(notification: AgentBackendNotification) => void>()
  private readonly activityListeners = new Set<(envelope: AgentEventEnvelope) => void>()
  private readonly modelSelectionListeners = new Set<(selection: UpdateAgentModelSelectionRequest) => void>()
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private resolveStart: ((status: AgentBackendStatus) => void) | undefined
  private startTimer: ReturnType<typeof setTimeout> | undefined
  private lastStartupStage: AgentBackendStartupStage | undefined
  private startupStartedAt: number | undefined
  private closing = false
  private closePromise: Promise<void> | undefined

  constructor(
    private readonly entryPath: string,
    private readonly fork: UtilityProcessFactory,
  ) {}

  getStatus(): AgentBackendStatus {
    return this.status
  }

  onStatusChange(listener: (status: AgentBackendStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onNotification(listener: (notification: AgentBackendNotification) => void): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  onActivityEvent(listener: (envelope: AgentEventEnvelope) => void): () => void {
    this.activityListeners.add(listener)
    return () => this.activityListeners.delete(listener)
  }

  onModelSelection(listener: (selection: UpdateAgentModelSelectionRequest) => void): () => void {
    this.modelSelectionListeners.add(listener)
    return () => this.modelSelectionListeners.delete(listener)
  }

  async start(
    options: AgentBackendInitOptions,
    timeoutMs = DEFAULT_START_TIMEOUT_MS,
  ): Promise<AgentBackendStatus> {
    if (this.child) throw new Error('Agent backend process has already been started')
    this.closing = false
    this.lastStartupStage = undefined
    this.startupStartedAt = undefined
    this.setStatus({ state: 'starting' })

    let resolveStart!: (status: AgentBackendStatus) => void
    const startPromise = new Promise<AgentBackendStatus>((resolve) => {
      resolveStart = resolve
    })
    this.resolveStart = resolveStart

    try {
      const child = this.fork(this.entryPath)
      this.child = child
      child.on('message', (message) => this.handleMessage(message))
      child.once('exit', () => this.handleExit())
      child.once('error', (type, location, report) => {
        console.error('[agent-backend] process error', { type, location, report })
        this.failStart('Agent backend failed to start.')
      })
      child.once('spawn', () => {
        if (this.status.state !== 'starting' || this.child !== child) return
        this.startupStartedAt = Date.now()
        this.logStartupStage(
          'process_spawned',
          child.pid === undefined ? undefined : `pid=${child.pid}`,
        )
        this.startTimer = setTimeout(() => {
          console.error(
            `[agent-backend] start timed out after ${timeoutMs}ms; last startup stage: ${this.lastStartupStage ?? 'unknown'}`,
          )
          this.failStart('Agent backend start timed out.')
        }, timeoutMs)
        try {
          child.postMessage({ type: 'initialize', options } satisfies MainToAgentBackendMessage)
        } catch {
          this.failStart('Agent backend failed to start.')
        }
      })
    } catch {
      this.failStart('Agent backend failed to start.')
    }

    return startPromise
  }

  request<T = unknown>(request: AgentBackendRequest, timeoutMs = 15_000): Promise<T> {
    const child = this.child
    if (!child || this.closing || this.status.state !== 'ready') {
      return Promise.reject(new Error('Agent backend is unavailable.'))
    }

    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error('Agent backend request timed out.'))
      }, timeoutMs)
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      try {
        child.postMessage({ type: 'request', requestId: id, ...request } satisfies MainToAgentBackendMessage)
      } catch {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(new Error('Agent backend is unavailable.'))
      }
    })
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    const child = this.child
    this.child = undefined
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Agent backend is shutting down.'))
    }
    this.pendingRequests.clear()
    if (this.startTimer) clearTimeout(this.startTimer)
    this.resolveStart?.({ state: 'unavailable', message: 'Agent backend is shutting down.' })
    this.resolveStart = undefined
    if (!child) return Promise.resolve()
    this.closePromise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, 10_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      try {
        child.postMessage({
          type: 'shutdown',
        } satisfies MainToAgentBackendMessage)
      } catch {
        clearTimeout(timer)
        child.kill()
        resolve()
      }
    })
    return this.closePromise
  }

  private handleMessage(rawMessage: unknown): void {
    if (!isRecord(rawMessage) || typeof rawMessage.type !== 'string') return
    const message = rawMessage as unknown as AgentBackendToMainMessage
    if (message.type === 'startup-stage') {
      if (this.status.state !== 'starting') return
      this.logStartupStage(message.stage, message.detail)
      return
    }
    if (message.type === 'ready') {
      if (this.status.state !== 'starting') return
      if (this.startTimer) clearTimeout(this.startTimer)
      if (this.lastStartupStage !== 'ready') this.logStartupStage('ready')
      this.setStatus({ state: 'ready', info: message.info as AgentBackendInfo })
      this.resolveStart?.(this.status)
      this.resolveStart = undefined
      return
    }
    if (message.type === 'failed') {
      console.error('[agent-backend] initialization failed', message.message)
      this.failStart(message.message || 'Agent backend failed to initialize.')
      return
    }
    if (message.type === 'notification') {
      for (const listener of this.notificationListeners) listener(message.notification)
      return
    }
    if (message.type === 'model-selection') {
      for (const listener of this.modelSelectionListeners) listener(message.selection)
      return
    }
    if (message.type === 'activity-event') {
      for (const listener of this.activityListeners) listener(message.envelope)
      return
    }
    if (message.type === 'response') this.handleResponse(message)
  }

  private handleResponse(message: Extract<AgentBackendToMainMessage, { type: 'response' }>): void {
    const pending = this.pendingRequests.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingRequests.delete(message.id)
    if (message.ok) pending.resolve(message.value)
    else pending.reject(new Error(message.message || 'Agent backend request failed.'))
  }

  private handleExit(): void {
    this.child = undefined
    if (this.closing) return
    if (this.status.state === 'starting') {
      this.failStart('Agent backend stopped unexpectedly.')
    } else if (this.status.state === 'ready') {
      this.setStatus({ state: 'unavailable', message: 'Agent backend stopped unexpectedly.' })
    }
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Agent backend stopped unexpectedly.'))
    }
    this.pendingRequests.clear()
  }

  private failStart(message: string): void {
    if (this.status.state !== 'starting') return
    if (this.startTimer) clearTimeout(this.startTimer)
    this.setStatus({ state: 'unavailable', message })
    this.resolveStart?.(this.status)
    this.resolveStart = undefined
    this.child?.kill()
  }

  private setStatus(status: AgentBackendStatus): void {
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private logStartupStage(stage: AgentBackendStartupStage, detail?: string): void {
    this.lastStartupStage = stage
    const elapsed =
      this.startupStartedAt === undefined ? '' : ` in ${Date.now() - this.startupStartedAt}ms`
    const suffix = detail ? ` (${detail})` : ''
    console.info(`[agent-backend] ${stage}${suffix}${elapsed}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
