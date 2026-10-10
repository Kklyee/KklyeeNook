import type { PiSessionRuntimePort } from './pi-session-runtime'
import type { PiSessionRuntimeOptions } from './pi-session-runtime'
import type { PiHostUiResponse } from '@assistant-ui/react-pi/node'

export type PiSessionRuntimeFactory = (
  sessionId: string,
  options?: PiSessionRuntimeOptions,
) => PiSessionRuntimePort

/** Owns the per-session runtime registry and its lifecycle. */
export class PiSessionRuntimeManager {
  private readonly runtimes = new Map<string, PiSessionRuntimePort>()

  constructor(private readonly createRuntime: PiSessionRuntimeFactory) {}

  get(sessionId: string): PiSessionRuntimePort | undefined {
    return this.runtimes.get(sessionId)
  }

  getOrCreate(sessionId: string, options?: PiSessionRuntimeOptions): PiSessionRuntimePort {
    const existing = this.runtimes.get(sessionId)
    if (existing) return existing

    const runtime = options ? this.createRuntime(sessionId, options) : this.createRuntime(sessionId)
    this.runtimes.set(sessionId, runtime)
    return runtime
  }

  respondToExtensionUiRequest(sessionId: string, response: PiHostUiResponse): void {
    const preferred = this.runtimes.get(sessionId)
    const candidates = preferred
      ? [preferred, ...Array.from(this.runtimes.values()).filter((runtime) => runtime !== preferred)]
      : Array.from(this.runtimes.values())
    let lastError: unknown

    for (const runtime of candidates) {
      try {
        runtime.respondToExtensionUiRequest(response)
        return
      } catch (error) {
        lastError = error
      }
    }

    if (lastError instanceof Error) throw lastError
    throw new Error(`Unknown Pi extension UI request: ${response.requestId}`)
  }

  delete(sessionId: string): void {
    this.runtimes.get(sessionId)?.dispose()
    this.runtimes.delete(sessionId)
  }

  reloadConfiguration(): void {
    this.assertCanReloadConfiguration()
    for (const runtime of this.runtimes.values()) runtime.reloadConfiguration()
  }

  assertCanReloadConfiguration(): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.isRunning()) throw new Error('请等待当前 Agent 运行结束后再修改设置')
    }
  }

  dispose(): void {
    for (const runtime of this.runtimes.values()) runtime.dispose()
    this.runtimes.clear()
  }
}
