import type { AgentRun } from '../../shared/agent/agentRun'

export class AgentSession {
  readonly id: string
  readonly createdAt: number
  private runs = new Map<string, AgentRun>()

  constructor(id: string) {
    this.id = id
    this.createdAt = Date.now()
  }

  addRun(run: AgentRun): void {
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
}
