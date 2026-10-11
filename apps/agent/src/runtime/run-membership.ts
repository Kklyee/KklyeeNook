import { defineDoc, defineExtension, GenerationTask, hook, LiveDoc, type Harness } from '@earendil-works/pi-durable'

export const runMembershipDoc = defineDoc<{ tasks: Record<string, number> }>({
  kind: 'nook.run-membership', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ tasks: {} }),
})

export const createRunMembershipExtension = (harness: () => Harness) => defineExtension({
  name: 'nook.run-membership',
  hooks: [hook(GenerationTask, {
    async beforeRequest(_request, api, context) {
      const live = await api.snapshot(LiveDoc, api.conversationId, context)
      const input = live?.run?.inputs[0]
      if (input !== undefined) await harness().commit(async (tx) => {
        const doc = await tx.doc(runMembershipDoc, api.conversationId)
        doc.tasks[String(api.taskId)] ??= input
      }, context)
      return undefined
    },
  })],
})
