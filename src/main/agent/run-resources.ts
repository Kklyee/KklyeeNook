import type { Context } from '@earendil-works/chord'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  defineDoc,
  LiveDoc,
  type ConversationId,
  type DocumentWatch,
  type LiveState,
  type SubmissionId,
} from '@earendil-works/pi-durable'
import type { SandboxService } from '../sandbox/sandboxService'
import type { AgentEngine } from './agent-engine'

const leases = defineDoc<{
  runs: Record<string, { conversationId: ConversationId; inputId: SubmissionId }>
}>({ kind: 'nook.run-resources', version: 1, scope: 'session', initial: () => ({ runs: {} }) })

export class RunResources {
  private engine: AgentEngine | undefined
  private readonly watches = new Map<ConversationId, DocumentWatch<LiveState>>()
  private tail: Promise<void> = Promise.resolve()
  private readonly known = new Set<string>()
  private closing: Promise<void> | undefined

  constructor(
    private readonly sandbox: Pick<SandboxService, 'finishRun'>,
    private readonly report: (error: unknown) => void = () => undefined,
  ) {}

  async connect(engine: AgentEngine, context: Context) {
    this.engine = engine
    const existing = await engine.harness.snapshot(leases, context)
    for (const runId of Object.keys(existing?.runs ?? {})) this.known.add(runId)
    for (const root of new Set(
      Object.values(existing?.runs ?? {}).map((lease) => lease.conversationId),
    )) {
      await this.observe(root, context)
    }
    await this.tail
  }

  async acquire(conversationId: ConversationId, context: Context) {
    if (this.closing) throw new Error('Agent resources are closing')
    const engine = this.engine!
    const root = await engine.ownerThread(conversationId, context)
    const live = await engine.harness.snapshot(LiveDoc, root.conversationId, context)
    const inputId = live?.run?.inputs[0]
    if (inputId === undefined) throw new Error('Tool resources require an active durable run')
    context.abortSignal?.throwIfAborted()
    const runId = `durable:${root.conversationId}:${inputId}`
    await engine.harness.commit(async (tx) => {
      ;(await tx.doc(leases)).runs[runId] = { conversationId: root.conversationId, inputId }
    }, context)
    this.known.add(runId)
    await this.observe(root.conversationId, context)
    if (this.closing) throw new Error('Agent resources are closing')
    return runId
  }

  close(shutdown: () => Promise<void>) {
    this.closing ??= this.shutdown(shutdown)
    return this.closing
  }

  private async shutdown(shutdown: () => Promise<void>) {
    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([...this.watches.values()].map((watch) => watch.stop()))
    this.watches.clear()
    results.push(...await Promise.allSettled([this.tail]))
    results.push(...await Promise.allSettled([shutdown()]))
    results.push(...await Promise.allSettled([...this.known].map((runId) => this.sandbox.finishRun(runId))))
    this.known.clear()
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length) throw new AggregateError(failures, 'Agent resource cleanup failed')
  }

  private async observe(id: ConversationId, context: Context) {
    if (this.watches.has(id)) return
    const watch = await this.engine!.harness.watchDoc(LiveDoc, id, BACKGROUND_CONTEXT)
    if (!watch) throw new Error('Run document not found')
    if (this.closing || this.watches.has(id)) {
      await watch.stop()
      return
    }
    this.watches.set(id, watch)
    const update = () => {
      this.tail = this.tail.then(() => this.release(id)).catch(this.report)
      return this.tail
    }
    await update()
    watch.start(async () => {
      await update()
    })
    void watch.closed.then(() => {
      this.watches.delete(id)
    })
    context.abortSignal?.throwIfAborted()
  }

  private async release(id: ConversationId) {
    const engine = this.engine!
    const doc = await engine.harness.snapshot(leases, BACKGROUND_CONTEXT)
    const live = await engine.harness.snapshot(LiveDoc, id, BACKGROUND_CONTEXT)
    for (const [runId, lease] of Object.entries(doc?.runs ?? {})) {
      if (lease.conversationId !== id || live?.run?.inputs.includes(lease.inputId)) continue
      await this.sandbox.finishRun(runId)
      await engine.harness.commit(async (tx) => {
        delete (await tx.doc(leases)).runs[runId]
      }, BACKGROUND_CONTEXT)
      this.known.delete(runId)
    }
  }
}
