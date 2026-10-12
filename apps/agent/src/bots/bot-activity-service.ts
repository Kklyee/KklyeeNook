import type { Context } from '@earendil-works/chord'
import { InboxDoc } from '@earendil-works/pi-durable'
import type { AgentHost } from '../runtime/agent-host'
import { botState } from '@kklyeenook/shared/bot/bot-state'
import { inputDoc } from '../runtime/inputs'

export class BotActivityService {
  constructor(private readonly host: AgentHost) {}

  async getStatus(botId: string, context: Context) {
    const bot = await this.host.bots!.get(botId)
    const threads = (await this.host.conversations.list(context)).filter(
      (thread) => thread.botId === botId && !thread.deletedAt,
    )
    const activeThreads: Array<{
      threadId: string
      title: string
      workspaceId?: string
      state: string
      updatedAt: number
    }> = []
    const conversations: Array<{
      taskId: string
      threadId: string
      title: string
      workspaceId?: string
      workspaceName?: string
      kind: 'conversation'
      status: string
      updatedAt: number
    }> = []
    const workspaces = await this.host.workspaces()
    const scheduledStates = new Map<string, string>()
    let queuedCount = 0
    let pendingApprovalCount = 0
    let failedCount = 0
    for (const thread of threads) {
      const snapshot = await this.host.conversations.snapshot(thread.id, context)
      const conversation = await this.host.engine.conversation(thread.id, context)
      const queue = await this.host.engine.harness.snapshot(InboxDoc, conversation.id, context)
      const approvals = await this.host.pendingApprovals(thread.id, context)
      queuedCount += queue?.items.length ?? 0
      pendingApprovalCount += approvals.length
      const state = botState(snapshot, approvals.length > 0)
      for (const [submissionId, status] of [
        ...(snapshot.run?.inputs ?? []).map(
          (id) => [id, approvals.length ? 'waiting_approval' : 'running'] as const,
        ),
        ...(queue?.items ?? []).map((item) => [item.id, 'queued'] as const),
      ]) {
        const submission = await (
          await this.host.engine.harness.submission(submissionId, context)
        )?.status(context)
        if (!submission?.requestId) continue
        const prepared = await this.host.engine.harness.snapshot(
          inputDoc,
          conversation.id,
          submission.requestId,
          context,
        )
        if (prepared?.scheduledTaskId) scheduledStates.set(prepared.scheduledTaskId, status)
      }
      conversations.push({
        taskId: thread.id,
        threadId: thread.id,
        title: thread.title,
        workspaceId: thread.workspaceId ?? undefined,
        workspaceName: workspaces.find((workspace) => workspace.id === thread.workspaceId)
          ?.displayName,
        kind: 'conversation',
        status: state,
        updatedAt: thread.updatedAt,
      })
      if (state === 'error') failedCount++
      if (
        snapshot.run ||
        snapshot.generation ||
        snapshot.tools.some((tool) => tool.status !== 'done') ||
        approvals.length
      ) {
        activeThreads.push({
          threadId: thread.id,
          title: thread.title,
          workspaceId: thread.workspaceId ?? undefined,
          state,
          updatedAt: thread.updatedAt,
        })
      }
    }
    const collaborations = ((await this.host.coordination?.list(context))?.tasks ?? []).filter(
      (task) => task.toBotId === botId || task.fromBotId === botId,
    )
    queuedCount += collaborations.filter(
      (task) => task.toBotId === botId && task.status === 'pending',
    ).length
    failedCount += collaborations.filter(
      (task) => task.status === 'failed' || task.status === 'rejected',
    ).length
    const scheduled = ((await this.host.scheduledTasks?.()) ?? [])
      .filter((task) => task.botId === botId)
      .map((task) => ({
        taskId: task.id,
        threadId: task.sessionId,
        title: task.title,
        kind: 'scheduled' as const,
        status: scheduledStates.get(task.id) ?? (task.enabled ? 'scheduled' : 'disabled'),
        updatedAt: task.updatedAt,
      }))
    const tasks = collaborations.map((task) => ({
      taskId: task.id,
      threadId: task.targetThreadId,
      kind: 'collaboration' as const,
      status: task.status,
      direction: task.toBotId === botId ? 'incoming' : 'outgoing',
      updatedAt: task.updatedAt,
    }))
    const runningCount = activeThreads.length
    const awaitingTask = collaborations.some(
      (task) =>
        task.fromBotId === botId &&
        task.mode === 'await' &&
        ['pending', 'accepted', 'running'].includes(task.status) &&
        activeThreads.some((thread) => thread.threadId === task.sourceThreadId),
    )
    const state =
      pendingApprovalCount || awaitingTask
        ? 'waiting'
        : activeThreads.some((thread) => thread.state === 'working')
          ? 'working'
          : runningCount
            ? 'thinking'
            : queuedCount
              ? 'waiting'
              : 'idle'
    return {
      botId,
      name: bot.name,
      role: bot.role,
      observedAt: Date.now(),
      state,
      activeThreads,
      tasks: [...conversations, ...tasks, ...scheduled],
      runningCount,
      queuedCount,
      pendingApprovalCount,
      failedCount,
    }
  }

  async listTasks(botId: string, context: Context) {
    const snapshot = await this.getStatus(botId, context)
    return snapshot
  }
}
