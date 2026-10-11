import {
  AgentDoc,
  configure,
  GenerationTask,
  type RegistryReader,
} from '@earendil-works/pi-durable'
import type { AgentInputs } from './inputs'

export function submissionRegistry(registry: RegistryReader, inputs: AgentInputs): RegistryReader {
  const task: typeof GenerationTask = {
    ...GenerationTask,
    definition: {
      ...GenerationTask.definition,
      phases: {
        ...GenerationTask.definition.phases,
        async prepare(task, runtime, context) {
          const captured = await inputs.activeConfig(runtime.conversationId, runtime, context)
          if (captured)
            await runtime.commit(async (tx) => {
              await configure(tx, runtime.conversationId, {
                model: captured.agent.model,
                thinkingLevel: captured.agent.thinkingLevel,
                instructions: captured.agent.instructions,
                cwd: captured.agent.cwd ?? null,
              })
              const agent = await tx.doc(AgentDoc, runtime.conversationId)
              agent.tools = [...captured.tools]
              if (Array.isArray(agent.extensions))
                agent.extensions = [
                  ...agent.extensions.filter(
                    (name) =>
                      name !== 'nook.personal' && name !== 'nook.coding' && name !== 'nook.bot',
                  ),
                  'nook.bot',
                ]
              return undefined
            }, context)
          await GenerationTask.definition.phases.prepare(task, runtime, context)
        },
      },
    },
  }
  return {
    subscribe: (listener) => registry.subscribe(listener),
    snapshot() {
      const snapshot = registry.snapshot()
      return {
        installed: () => snapshot.installed(),
        extension: (name) => snapshot.extension(name),
        tools: () => snapshot.tools(),
        sections: () => snapshot.sections(),
        tasks: () =>
          snapshot
            .tasks()
            .map((original) =>
              original.definition.name === task.definition.name ? task : original,
            ),
        task: (name) => (name === task.definition.name ? task : snapshot.task(name)),
      }
    },
  }
}
