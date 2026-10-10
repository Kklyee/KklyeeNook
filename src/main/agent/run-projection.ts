import type { Context, JsonValue } from '@earendil-works/chord'
import { GenerationTask, watchEvents, type ConversationId, type ConversationRecord, type SnapshotEvent, type TaskRecord } from '@earendil-works/pi-durable'
import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentRun } from '@/shared/agent/agentRun'
import type { AgentExecutionRecord } from '@/shared/agent/agentExecutionRecord'
import type { ToolResult } from '@/shared/tool/tool'
import type { AgentHost } from './agent-host'
import { runMembershipDoc } from './run-membership'

type Record = TaskRecord<JsonValue, JsonValue, JsonValue>
type Group = { id: string; conversation: ConversationRecord; tasks: Record[]; snapshot: SnapshotEvent }

export class RunProjection {
  constructor(private readonly host: AgentHost) {}

  async list(threadId: string, context: Context): Promise<AgentRun[]> {
    const root = await this.host.engine.conversation(threadId, context)
    const graph = await this.graph(root.id, context)
    const groups = await this.groups(graph, context)
    const byTask = new Map<number, Group>(groups.flatMap((group) => group.tasks.map((task) => [task.id, group] as const)))
    const runs = groups.map((group): AgentRun => {
      const first = group.tasks[0]
      const last = group.tasks.at(-1)!
      const records = this.project(group, graph.tasks, threadId)
      const owner = group.conversation.owner ? graph.tasks.find((task) => task.id === group.conversation.owner!.taskId) : undefined
      const status = last.state.status === 'terminal'
        ? last.state.outcome.status === 'completed' ? 'completed' : last.state.outcome.status === 'aborted' ? 'aborted' : 'failed'
        : last.state.status === 'pending' ? 'created' : last.state.status === 'waiting' ? 'waiting' : 'running'
      return {
        id: group.id, sessionId: threadId, status, parentRunId: owner?.owner ? byTask.get(owner.owner)?.id : undefined,
        createdAt: first.startedAt ?? 0, startedAt: first.startedAt, updatedAt: last.endedAt ?? last.startedAt ?? 0,
        completedAt: last.endedAt,
        toolCalls: records.flatMap((record) => record.event.type === 'tool_started' ? [record.event.call] : []),
        toolResults: records.flatMap((record) => record.event.type === 'tool_finished' ? [record.event.result] : []),
        result: records.flatMap((record) => record.event.type === 'text_delta' ? [record.event.text] : []).join(''),
      }
    })
    for (const run of runs) {
      let parent = run
      let depth = 0
      const visited = new Set<string>()
      while (parent.parentRunId && !visited.has(parent.id)) {
        visited.add(parent.id)
        const next = runs.find((item) => item.id === parent.parentRunId)
        if (!next) break
        parent = next
        depth++
      }
      run.depth = depth
      run.rootRunId = parent.id
    }
    return runs.sort((a, b) => b.createdAt - a.createdAt)
  }

  async records(runId: string, context: Context): Promise<AgentExecutionRecord[]> {
    const child = runId.startsWith('durable-child:')
    const id = Number(child ? runId.slice('durable-child:'.length) : runId)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Run not found')
    const task = await this.host.engine.harness.commit(async (tx) => child
      ? (await tx.scanTasks({ conversationId: id as ConversationId, kind: GenerationTask.definition.name }, 1)).items[0]
      : tx.task(id as Record['id']), context)
    if (!task || task.kind !== GenerationTask.definition.name) throw new Error('Run not found')
    const root = await this.host.engine.ownerThread(task.conversationId, context)
    await this.host.conversations.getLive(root.threadId, context)
    const graph = await this.graph(root.conversationId, context)
    const group = (await this.groups(graph, context)).find((item) => item.id === runId)
    if (!group) throw new Error('Run not found')
    return this.project(group, graph.tasks, root.threadId)
  }

  private async groups(graph: { conversations: ConversationRecord[]; tasks: Record[] }, context: Context) {
    const groups: Group[] = []
    for (const conversation of graph.conversations) {
      const snapshot = await this.snapshot(conversation.id, context)
      const membership = await this.host.engine.harness.snapshot(runMembershipDoc, conversation.id, context)
      const current = new Map<string, Group>()
      const tasks = graph.tasks.filter((task) => task.conversationId === conversation.id && task.kind === GenerationTask.definition.name).sort((a, b) => a.id - b.id)
      for (const task of tasks) {
        const input = membership?.tasks[String(task.id)]
        const key = input === undefined ? 'task:' + task.id : 'input:' + input
        let group = current.get(key)
        if (!group) {
          group = { id: conversation.owner ? 'durable-child:' + conversation.id : String(task.id), conversation, tasks: [], snapshot }
          current.set(key, group)
          groups.push(group)
        }
        group.tasks.push(task)
      }
    }
    return groups
  }

  private project(group: Group, tasks: readonly Record[], threadId: string): AgentExecutionRecord[] {
    const output: AgentExecutionRecord[] = []
    const ids = new Set<number>(group.tasks.map((task) => task.id))
    const push = (event: AgentEvent, timestamp: number) => output.push({
      id: output.length + 1, seq: output.length + 1, runId: group.id, sessionId: threadId, timestamp, event,
    })
    push({ type: 'agent_started' }, group.tasks[0].startedAt ?? 0)
    for (const entry of group.snapshot.entries) {
      const owner = entry.byTaskId ? tasks.find((item) => item.id === entry.byTaskId) : undefined
      if (!entry.byTaskId || (!ids.has(entry.byTaskId) && (!owner?.owner || !ids.has(owner.owner)))) continue
      for (const message of entry.model ?? []) {
        if (message.role === 'assistant') {
          for (const part of message.content) {
            if (part.type === 'text') push({ type: 'text_delta', text: part.text }, message.timestamp)
            else if (part.type === 'thinking') push({ type: 'thinking_delta', text: part.thinking }, message.timestamp)
            else if (part.type === 'toolCall') push({ type: 'tool_started', call: { id: part.id, toolName: part.name, args: part.arguments } }, message.timestamp)
          }
        } else if (message.role === 'toolResult') {
          const result: ToolResult = {
            toolCallId: message.toolCallId, toolName: message.toolName,
            status: message.isError ? 'error' : 'success', content: message.content, details: message.details,
          }
          push({ type: 'tool_finished', result }, message.timestamp)
        }
      }
    }
    const last = group.tasks.at(-1)!
    if (last.state.status === 'terminal') {
      const outcome = last.state.outcome
      push(outcome.status === 'completed' ? { type: 'agent_completed' } : outcome.status === 'aborted'
        ? { type: 'agent_aborted' } : { type: 'agent_failed', error: String('error' in outcome ? outcome.error : outcome.status) }, last.endedAt ?? 0)
    }
    return output
  }

  private async snapshot(id: ConversationId, context: Context) {
    const watch = await watchEvents(this.host.engine.harness, id, context)
    try { return watch.snapshot } finally { await watch.stop() }
  }

  private async graph(root: ConversationId, context: Context) {
    return this.host.engine.harness.commit(async (tx) => {
      const conversations: ConversationRecord[] = []
      const tasks: Record[] = []
      const pending = [root]
      const visited = new Set<ConversationId>()
      for (let index = 0; index < pending.length; index++) {
        const id = pending[index]
        if (visited.has(id)) continue
        visited.add(id)
        const conversation = await tx.conversation(id)
        if (!conversation) continue
        conversations.push(conversation)
        let cursor: Readonly<import('@earendil-works/pi-durable').JsonObject> | undefined
        do {
          const page = await tx.scanTasks({ conversationId: id }, 256, cursor)
          tasks.push(...page.items)
          for (const task of page.items) {
            let children: typeof cursor
            do {
              const page = await tx.scanConversations({ ownerTaskId: task.id }, 256, children)
              pending.push(...page.items.map((item) => item.id))
              children = page.next
            } while (children)
          }
          cursor = page.next
        } while (cursor)
      }
      return { conversations, tasks }
    }, context)
  }
}
