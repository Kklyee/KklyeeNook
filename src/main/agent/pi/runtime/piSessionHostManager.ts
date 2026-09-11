import type { PiSessionHostLike } from './piSessionHost'

export type PiSessionHostFactory = (sessionId: string) => PiSessionHostLike

export class PiSessionHostManager {
  private readonly hosts = new Map<string, PiSessionHostLike>()

  constructor(private readonly createHost: PiSessionHostFactory) {}

  get(sessionId: string): PiSessionHostLike | undefined {
    return this.hosts.get(sessionId)
  }

  getOrCreate(sessionId: string): PiSessionHostLike {
    const existing = this.hosts.get(sessionId)
    if (existing) return existing

    const host = this.createHost(sessionId)
    this.hosts.set(sessionId, host)
    return host
  }

  delete(sessionId: string): void {
    this.hosts.get(sessionId)?.dispose()
    this.hosts.delete(sessionId)
  }

  reloadConfiguration(): void {
    for (const host of this.hosts.values()) {
      if (host.isRunning()) throw new Error('请等待当前 Agent 运行结束后再修改设置')
    }
    for (const host of this.hosts.values()) host.reloadConfiguration()
  }

  dispose(): void {
    for (const host of this.hosts.values()) host.dispose()
    this.hosts.clear()
  }
}
