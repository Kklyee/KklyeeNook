export class ExecutionSequencer {
  private readonly sequences = new Map<string, number>()

  restore(runId: string, seq: number): void {
    this.sequences.set(runId, seq)
  }

  next(runId: string): number {
    const seq = (this.sequences.get(runId) ?? 0) + 1
    this.sequences.set(runId, seq)
    return seq
  }
}
