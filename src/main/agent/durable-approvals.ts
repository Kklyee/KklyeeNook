import { isDeepStrictEqual } from 'node:util'
import { copyJson, type Context, type Draft } from '@earendil-works/chord'
import { awaitWithContext } from '@earendil-works/chord/context'
import type { ToolCall } from '@earendil-works/pi-ai'
import {
  defineDoc,
  defineExtension,
  hook,
  ToolTask,
  type ConversationId,
  type Harness,
  type HookApi,
  type JsonObject,
  type TaskId,
} from '@earendil-works/pi-durable'

import type { ApprovalRequirement, DurableApproval } from '@/shared/agent/durable-protocol'
export type { ApprovalRequirement, DurableApproval } from '@/shared/agent/durable-protocol'

export const approvalDoc = defineDoc<{ requests: Record<string, DurableApproval> }>({
  kind: 'nook.approvals',
  version: 1,
  scope: 'conversation',
  history: 'rewindable',
  fork: 'initial',
  initial: () => ({ requests: {} }),
})

type Assessment = ApprovalRequirement | { block: string } | undefined

type AssessTool = (call: ToolCall, api: HookApi, context: Context) => Promise<Assessment>

export class DurableApprovals {
  private harness: Harness | undefined
  readonly extension

  constructor(private readonly assess: AssessTool) {
    this.extension = defineExtension({
      name: 'nook.approvals',
      hooks: [
        hook(ToolTask, { beforeTool: (call, api, context) => this.before(call, api, context) }),
      ],
    })
  }

  connect(harness: Harness) {
    if (this.harness) throw new Error('Approval service already connected')
    this.harness = harness
  }

  async pending(conversationId: ConversationId, context: Context) {
    const harness = this.host()
    const doc = await harness.snapshot(approvalDoc, conversationId, context)
    const inspection = await harness.inspect(context)
    const live = new Set<TaskId>(
      inspection.tasks
        .filter(({ record }) => !record.abortRequested && record.conversationId === conversationId)
        .map(({ record }) => record.id),
    )
    return Object.values(doc?.requests ?? {}).filter(
      (request) => request.state === 'pending' && live.has(request.taskId),
    )
  }

  async decide(
    conversationId: ConversationId,
    id: string,
    state: 'approved' | 'rejected',
    context: Context,
  ) {
    if (state !== 'approved' && state !== 'rejected') throw new Error('Invalid approval decision')
    const harness = this.host()
    const snapshot = await harness.snapshot(approvalDoc, conversationId, context)
    const request = snapshot?.requests[id]
    if (!request || !Object.hasOwn(snapshot!.requests, id)) throw new Error('Approval not found')
    return harness.commit(async (tx) => {
      const task = await tx.task(request.taskId)
      const doc = await tx.doc(approvalDoc, conversationId)
      const current = doc.requests[id]
      if (current.state !== 'pending') {
        if (current.state !== state) throw new Error('Approval already decided')
        return current.state
      }
      const checkpoint = task && 'checkpoint' in task.state ? task.state.checkpoint : undefined
      if (
        !task ||
        task.conversationId !== conversationId ||
        task.abortRequested ||
        task.kind !== 'pi.tool' ||
        typeof checkpoint !== 'object' ||
        checkpoint === null ||
        !('phase' in checkpoint) ||
        checkpoint.phase !== 'call'
      ) {
        throw new Error('Approval no longer active')
      }
      current.state = state
      current.decidedAt = Date.now()
      return state
    }, context)
  }

  async authorized(
    conversationId: ConversationId,
    taskId: TaskId,
    call: ToolCall,
    requirement: ApprovalRequirement,
    context: Context,
  ) {
    const doc = await this.host().snapshot(approvalDoc, conversationId, context)
    const request = doc?.requests[`${conversationId}:${taskId}`]
    return (
      request?.state === 'approved' &&
      request.callId === call.id &&
      request.toolName === call.name &&
      isDeepStrictEqual(request.arguments, call.arguments) &&
      request.reason === requirement.reason &&
      isDeepStrictEqual(request.request, requirement.request)
    )
  }

  private host() {
    if (!this.harness) throw new Error('Approval service is not connected')
    return this.harness
  }

  private async before(call: ToolCall, api: HookApi, context: Context) {
    const requirement = await this.assess(call, api, context)
    if (!requirement || 'block' in requirement) return requirement
    const harness = this.host()
    const id = `${api.conversationId}:${api.taskId}`
    const expected = copyJson({
      callId: call.id,
      toolName: call.name,
      arguments: call.arguments,
      ...requirement,
    }) as Draft<ApprovalRequirement & { callId: string; toolName: string; arguments: JsonObject }>
    const matches = (request: DurableApproval) =>
      isDeepStrictEqual(
        {
          callId: request.callId,
          toolName: request.toolName,
          arguments: request.arguments,
          request: request.request,
          reason: request.reason,
        },
        expected,
      )
    await harness.commit(async (tx) => {
      const task = await tx.task(api.taskId)
      if (!task || task.abortRequested || task.state.status !== 'running') {
        throw new Error('Tool call no longer active')
      }
      const doc = await tx.doc(approvalDoc, api.conversationId)
      doc.requests[id] ??= {
        id,
        taskId: api.taskId,
        ...expected,
        state: 'pending',
        createdAt: Date.now(),
      }
    }, context)
    const watch = await harness.watchDoc(approvalDoc, api.conversationId, context)
    if (!watch) throw new Error('Approval document not found')
    try {
      const decision = new Promise<DurableApproval>((resolve, reject) => {
        const check = (value: typeof watch.value) => {
          const request = value?.requests[id]
          if (!request || !matches(request)) reject(new Error('Approval request changed'))
          else if (request.state !== 'pending') resolve(request)
        }
        check(watch.value)
        watch.start(async (value) => {
          check(value)
        })
        void watch.closed.then(() => reject(new Error('Approval watch closed')))
      })
      const request = await awaitWithContext(decision, context)
      return request.state === 'approved' ? undefined : { block: '用户拒绝本次执行' }
    } finally {
      await watch.stop()
    }
  }
}
