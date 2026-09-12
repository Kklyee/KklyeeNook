import type { PiSessionRuntimePort } from './piSessionRuntime'

export type PiSessionRuntimeFactory = (sessionId: string) => PiSessionRuntimePort

/** Owns the per-session runtime registry and its lifecycle. */
export class PiSessionRuntimeManager {
  private readonly runtimes = new Map<string, PiSessionRuntimePort>()

  constructor(private readonly createRuntime: PiSessionRuntimeFactory) {}

  get(sessionId: string): PiSessionRuntimePort | undefined {
    return this.runtimes.get(sessionId)
  }

  getOrCreate(sessionId: string): PiSessionRuntimePort {
    const existing = this.runtimes.get(sessionId)
    if (existing) return existing

    const runtime = this.createRuntime(sessionId)
    this.runtimes.set(sessionId, runtime)
    return runtime
  }

  delete(sessionId: string): void {
    this.runtimes.get(sessionId)?.dispose()
    this.runtimes.delete(sessionId)
  }

  reloadConfiguration(): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.isRunning()) throw new Error('请等待当前 Agent 运行结束后再修改设置')
    }
    for (const runtime of this.runtimes.values()) runtime.reloadConfiguration()
  }

  dispose(): void {
    for (const runtime of this.runtimes.values()) runtime.dispose()
    this.runtimes.clear()
  }
}
