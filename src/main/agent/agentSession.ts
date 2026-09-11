import { AgentSessionSummary } from '@/shared/agent/agentSession'
import type { AgentRun } from '../../shared/agent/agentRun'
import { AgentSessionRecord } from '../db/repositories/agentSessionRepo'

interface AgentSessionTimestamps {
  createdAt: number
  updatedAt: number
  archived?: boolean
}

export class AgentSession {
  readonly id: string
  readonly createdAt: number
  title: string
  updatedAt: number
  archived: boolean

  private runs = new Map<string, AgentRun>()

  constructor(id: string, title: string = 'New Task', timestamp?: AgentSessionTimestamps) {
    this.id = id
    this.title = title
    const now = Date.now()
    this.createdAt = timestamp?.createdAt ?? now
    this.updatedAt = timestamp?.updatedAt ?? now
    this.archived = timestamp?.archived ?? false
  }

  addRun(run: AgentRun): void {
    this.runs.set(run.id, run)
    this.touch()
  }

  restoreRun(run: AgentRun): void {
    this.runs.set(run.id, run)
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

  setArchived(archived: boolean): void {
    this.archived = archived
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
      archived: this.archived,
      activeRunId: activeRun?.id,
    }
  }

  toRecord(): AgentSessionRecord {
    return {
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      archived: this.archived,
    }
  }
}
