import { randomUUID } from 'node:crypto'

import type { AgentRuntime } from './agentRuntime'
import { AgentSession } from './agentSession'
import { AgentRun } from '@/shared/agent/agentRun'
import { getAgentRunPatch } from './agentRunState'

import { AgentEventEnvelope } from './agentEventEnvelope'
import { AgentEvent } from '@/shared/agent/agentEvent'
import { AgentSessionSummary } from '@/shared/agent/agentSession'

export interface AgentRunHandle {
  run: AgentRun
  completion: Promise<AgentRun>
}
type AgentEventListener = (envelope: AgentEventEnvelope) => void

export class AgentService {
  private readonly sessions = new Map<string, AgentSession>()
  private readonly listeners = new Set<AgentEventListener>()

  constructor(private readonly runtime: AgentRuntime) {}

  createSession(title?: string): AgentSessionSummary {
    const session = new AgentSession(randomUUID(), title)
    this.sessions.set(session.id, session)
    return session.toSummary()
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId)
  }

  renameSession(sessionId: string, newTitle: string): AgentSessionSummary {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`AgentSession not found: ${sessionId}`)
    }
    session.rename(newTitle)
    return session.toSummary()
  }

  deleteSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`AgentSession not found: ${sessionId}`)
    }
    this.sessions.delete(sessionId)
  }

  getSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
  }

  listSessions(): AgentSessionSummary[] {
    return Array.from(this.sessions.values())
      .map((session) => session.toSummary())
      .sort((a, b) => b.updatedAt - a.updatedAt)
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
    const patch = getAgentRunPatch(run, event)
    if (patch) {
      session.updateRun(runId, patch)
    }
    this.publish({ sessionId: session.id, runId, timestamp: Date.now(), event })
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

    const run: AgentRun = { id: randomUUID(), sessionId, status: 'created', startedAt: Date.now() }
    session.addRun(run)
    const completion = Promise.resolve().then(() =>
      this.executeRun(session, run.id, prompt, signal),
    )

    return { run, completion }
  }

  private async executeRun(
    session: AgentSession,
    runId: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<AgentRun> {
    try {
      await this.runtime.run(
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

    const finalRun = session.getRun(runId)

    if (!finalRun) {
      throw new Error(`AgentRun not found: ${runId}`)
    }

    return finalRun
  }
}
