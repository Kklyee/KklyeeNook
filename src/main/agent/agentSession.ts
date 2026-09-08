import { AgentSessionSummary } from '@/shared/agent/agentSession'
import type { AgentRun } from '../../shared/agent/agentRun'

export class AgentSession {
  readonly id: string
  readonly createdAt: number
  private title: string
  private updatedAt: number

  private runs = new Map<string, AgentRun>()

  constructor(id: string, title: string = 'New Task') {
    this.id = id
    const now = Date.now()
    this.createdAt = now
    this.updatedAt = now
    this.title = title
  }

  addRun(run: AgentRun): void {
    this.runs.set(run.id, run)

    this.touch()
  }

  getRun(runId: string): AgentRun | undefined {
    return this.runs.get(runId)
  }

  getRuns(): AgentRun[] {
    return Array.from(this.runs.values())
  }

  updateRun(runId: string, patch: Partial<AgentRun>): AgentRun {
    const run = this.runs.get(runId)

    if (!run) {
      throw new Error(`AgentRun not found: ${runId}`)
    }

    const updatedRun: AgentRun = { ...run, ...patch }
    this.runs.set(runId, updatedRun)
    return updatedRun
  }

  rename(title: string): void {
    const normalized = title.trim()

    if (!normalized) {
      return
    }

    this.title = normalized
    this.touch()
  }

  touch(): void {
    this.updatedAt = Date.now()
  }

  getTitle(): string {
    return this.title
  }

  getUpdatedAt(): number {
    return this.updatedAt
  }

  toSummary(): AgentSessionSummary {
    const runs = this.getRuns()

    const activeRun = runs.find(
      (run) => run.status === 'created' || run.status === 'running' || run.status === 'waiting',
    )

    return {
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      activeRunId: activeRun?.id,
    }
  }
}
