import { Type } from 'typebox'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import type { AgentHost } from '../runtime/agent-host'
import type { ToolRegistry } from '../tools/toolRegistry'
import { defineExecutableTool } from '../tools/executable-tool'
import { BotError } from '../bots/bot-service'

export function registerGroveTools(registry: ToolRegistry, getHost: () => AgentHost) {
  const id = Type.String({ minLength: 1, maxLength: 200 })
  const text = Type.String({ minLength: 1, maxLength: 64000 })
  const definitions = [
    {
      name: 'bot.send_message',
      description:
        'Send a message to an existing local Bot by its ID. Messages are recorded without invoking its model.',
      schema: Type.Object({ toBotId: id, content: text }, { additionalProperties: false }),
    },
    {
      name: 'bot.request_task',
      description:
        'Request collaboration from an existing independent local Bot by its ID. It uses its own instructions, model and authorized Workspace. Returns a task ID; the result arrives automatically. Do not repeatedly poll. Built-in IDs: xiaoya, coder.',
      schema: Type.Object({ toBotId: id, instruction: text }, { additionalProperties: false }),
    },
    {
      name: 'bot.get_task',
      description: 'Read the current status and result of a collaboration involving this Bot.',
      schema: Type.Object({ taskId: id }, { additionalProperties: false }),
    },
  ]
  return definitions.map(({ name, description, schema }) =>
    registry.register({
      definition: { name, label: name, description, inputSchema: schema, replay: 'safe' },
      adapter: {
        create: () =>
          defineExecutableTool({
            name,
            description,
            parameters: schema,
            async execute(callId, args, signal, _update, execution) {
              const host = getHost()
              const api = execution?.api
              if (!host.grove || !api)
                throw new BotError(403, 'Authenticated Bot tool context required')
              const context = signal
                ? withAbortSignal(signal, BACKGROUND_CONTEXT)
                : BACKGROUND_CONTEXT
              const owner = await host.engine.ownerThread(api.conversationId, context)
              const parentTaskId = await host.inputs.activeGroveTask(owner.conversationId, context)
              const caller = { threadId: owner.threadId, parentTaskId }
              const input = args as {
                toBotId: string
                instruction: string
                content: string
                taskId: string
              }
              const operationId = `${api.taskId}:${callId}`
              const details =
                name === 'bot.send_message'
                  ? await host.grove.sendMessage(caller, { ...input, operationId }, context)
                  : name === 'bot.request_task'
                    ? await host.grove.requestTask(caller, { ...input, operationId }, context)
                    : await host.grove.getTask(caller, input.taskId, context)
              return { content: [{ type: 'text', text: JSON.stringify(details) }], details }
            },
          }),
      },
    }),
  )
}
