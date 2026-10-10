import { Type } from 'typebox'
import type { Context } from '@earendil-works/chord'
import {
  configure,
  defineExtension,
  defineTool,
  type ConversationId,
  type EntryId,
  type Harness,
} from '@earendil-works/pi-durable'
import type { DurableInputs } from './durable-inputs'

export class DurableDelegation {
  private harness: Harness | undefined
  readonly tool
  readonly extension

  constructor(private readonly inputs: DurableInputs) {
    this.tool = defineTool({
      name: 'delegate_task',
      description:
        'Delegate a focused task to an independent child conversation. Only explicit task, context, selected skills and workspace memory are passed. At most two children may run concurrently; children cannot delegate.',
      parameters: Type.Object({
        task: Type.String({ minLength: 1 }),
        context: Type.Optional(Type.String()),
        skillIds: Type.Optional(Type.Array(Type.String())),
      }),
      replay: 'safe',
      execute: async (args, api, context) => {
        if (!args.task.trim()) throw new Error('Task is required')
        const agent = await api.agent(context)
        const id = await api.commit(async (tx) => {
          const parent = await tx.conversation(api.conversationId)
          if (parent?.owner !== undefined) throw new Error('Child conversations cannot delegate')
          const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0]
          if (existing) return existing.id
          const caller = await tx.task(api.taskId)
          let active = 0
          let cursor
          do {
            const page = await tx.scanTasks(
              { conversationId: api.conversationId, kind: 'pi.tool' },
              100,
              cursor,
            )
            for (const task of page.items) {
              if (
                task.id === api.taskId ||
                task.state.status === 'terminal' ||
                task.owner === undefined ||
                caller?.owner === undefined ||
                task.owner !== caller.owner
              )
                continue
              if ((await tx.scanConversations({ ownerTaskId: task.id }, 1)).items.length) active++
            }
            cursor = page.next
          } while (cursor)
          if (active >= 2) throw new Error('At most two child conversations may run concurrently')
          const child = await tx.createConversation({
            ownership: { kind: 'task', taskId: api.taskId },
          })
          await configure(tx, child.id, {
            extensions: agent.extensions.filter(
              (extension) => extension.name !== this.extension.name,
            ),
            tools: agent.tools.filter((tool) => tool.name !== this.tool.name),
          })
          return child.id
        }, context)
        await api.details(
          {
            conversationId: id,
            runId: `durable-child:${id}`,
            name: args.task.slice(0, 80),
            task: args.task,
            status: 'running',
          },
          context,
        )
        const child = await api.conversation(id, context)
        if (!child) throw new Error('Child conversation not found')
        const submission = await this.inputs.submit(
          child,
          {
            type: 'input',
            requestId: `delegate:${api.taskId}`,
            content:
              args.task +
              (args.context?.trim() ? '\n\nExplicit context:\n' + args.context.trim() : ''),
            skillIds: args.skillIds,
          },
          context,
        )
        const settled = await submission.wait(context)
        const result =
          settled.status === 'done' && settled.type === 'input'
            ? await this.answer(id, settled.answer, context)
            : settled.status === 'unanswered'
              ? settled.reason
              : 'Child did not return an answer'
        const details = {
          conversationId: id,
          runId: `durable-child:${id}`,
          name: args.task.slice(0, 80),
          task: args.task,
          status: settled.status === 'done' ? 'completed' : 'failed',
          result,
        }
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details }
      },
    })
    this.extension = defineExtension({ name: 'nook.delegation', tools: [this.tool] })
  }

  connect(harness: Harness) {
    this.harness = harness
  }

  private async answer(id: ConversationId, entryId: EntryId, context: Context) {
    const conversation = await this.harness!.conversation(id, context)
    return conversation!.commit(async (tx) => {
      const entry = await tx.entry(entryId)
      return (entry?.model ?? [])
        .flatMap((message) =>
          typeof message.content === 'string'
            ? [message.content]
            : message.content.filter((part) => part.type === 'text').map((part) => part.text),
        )
        .join('\n')
    }, context)
  }
}
