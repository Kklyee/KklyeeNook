import { randomUUID } from 'node:crypto'

import type {
  AgentBackendInfo,
  AgentBackendInitOptions,
  AgentBackendRequest,
  AgentBackendStatus,
  AgentBackendToMainMessage,
  MainToAgentBackendMessage,
} from './protocol'
import type { PiClientEvent } from '@assistant-ui/react-pi'
import type { PiSubscribeRequest, PiSubscriptionListener } from '@/shared/pi/piIpc'

export interface UtilityProcessLike {
  on(event: 'message', listener: (message: unknown) => void): unknown
  once(event: 'exit', listener: (code: number) => void): unknown
  once(event: 'error', listener: (type: 'FatalError', location: string, report: string) => void): unknown
  postMessage(message: unknown): void
  kill(): boolean
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
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly piSubscriptions = new Map<string, PiSubscriptionListener>()
  private resolveStart: ((status: AgentBackendStatus) => void) | undefined
  private startTimer: ReturnType<typeof setTimeout> | undefined
  private closing = false

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

  async start(
    options: AgentBackendInitOptions,
    timeoutMs = 15_000,
  ): Promise<AgentBackendStatus> {
    if (this.child) throw new Error('Agent backend process has already been started')
    this.closing = false
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
      child.once('error', () => this.failStart('Agent backend failed to start.'))
      this.startTimer = setTimeout(() => {
        this.failStart('Agent backend start timed out.')
      }, timeoutMs)
      child.postMessage({ type: 'initialize', options } satisfies MainToAgentBackendMessage)
    } catch {
      this.failStart('Agent backend failed to start.')
    }

    return startPromise
  }

  request<T = unknown>(request: AgentBackendRequest, timeoutMs = 15_000): Promise<T> {
    const child = this.child
    if (!child || this.status.state !== 'ready') {
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
        child.postMessage({ type: 'request', id, ...request } satisfies MainToAgentBackendMessage)
      } catch {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(new Error('Agent backend is unavailable.'))
      }
    })
  }

  subscribePi(request: PiSubscribeRequest, listener: PiSubscriptionListener): () => void {
    const child = this.child
    if (!child || this.status.state !== 'ready') return () => undefined

    const subscriptionId = randomUUID()
    this.piSubscriptions.set(subscriptionId, listener)
    try {
      child.postMessage({ type: 'pi:subscribe', subscriptionId, request })
    } catch {
      this.piSubscriptions.delete(subscriptionId)
      return () => undefined
    }

    let active = true
    return () => {
      if (!active) return
      active = false
      this.piSubscriptions.delete(subscriptionId)
      try {
        child.postMessage({ type: 'pi:unsubscribe', subscriptionId })
      } catch {
        // The process may already have exited.
      }
    }
  }

  close(): void {
    this.closing = true
    const child = this.child
    this.child = undefined
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Agent backend is shutting down.'))
    }
    this.pendingRequests.clear()
    for (const subscriptionId of this.piSubscriptions.keys()) {
      try {
        child?.postMessage({ type: 'pi:unsubscribe', subscriptionId })
      } catch {
        // The process may already have exited.
      }
    }
    this.piSubscriptions.clear()
    if (this.startTimer) clearTimeout(this.startTimer)
    this.resolveStart?.({ state: 'unavailable', message: 'Agent backend is shutting down.' })
    this.resolveStart = undefined
    if (!child) return
    try {
      child.postMessage({ type: 'shutdown' } satisfies MainToAgentBackendMessage)
    } catch {
      // The process may already have exited.
    }
    child.kill()
  }

  private handleMessage(rawMessage: unknown): void {
    if (!isRecord(rawMessage) || typeof rawMessage.type !== 'string') return
    const message = rawMessage as unknown as AgentBackendToMainMessage
    if (message.type === 'ready') {
      if (this.status.state !== 'starting') return
      if (this.startTimer) clearTimeout(this.startTimer)
      this.setStatus({ state: 'ready', info: message.info as AgentBackendInfo })
      this.resolveStart?.(this.status)
      this.resolveStart = undefined
      return
    }
    if (message.type === 'failed') {
      this.failStart('Agent backend failed to initialize.')
      return
    }
    if (message.type === 'pi:event') {
      const listener = this.piSubscriptions.get(message.subscriptionId)
      if (listener) listener(message.event as PiClientEvent)
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
    this.piSubscriptions.clear()
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
