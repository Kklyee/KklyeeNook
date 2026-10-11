import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { testHost } from './host'

let fixture: Awaited<ReturnType<typeof testHost>>
process.on('message', (input) => {
  const message = input as { id: number; command: string; input: any }
  void run(message.command, message.input).then(
    (value) =>
      process.send!({ id: message.id, value }, () => {
        if (message.command === 'close') process.exit(0)
      }),
    (error) =>
      process.send!({
        id: message.id,
        error: error instanceof Error ? error.message : 'Host command failed',
      }),
  )
})

async function run(command: string, input: any): Promise<unknown> {
  if (command === 'init') {
    fixture = await testHost(input.relayUrl, input.token, input.name, input.answer, {
      directory: input.directory,
      cleanup: false,
    })
    return undefined
  }
  const host = fixture.host
  if (command === 'sync') return host.grove!.syncNetwork(BACKGROUND_CONTEXT)
  if (command === 'identities') return fixture.repo.identities()
  if (command === 'tasks') return fixture.repo.tasks()
  if (command === 'task') return fixture.repo.getTask(input.id)
  if (command === 'outbox') return fixture.repo.outbox()
  if (command === 'inbox') return fixture.repo.inbox()
  if (command === 'requests') return fixture.requests
  if (command === 'policy')
    return host.grove!.setPolicy(
      input.botId,
      { messages: input.messages, tasks: input.tasks, allowedBotIds: null },
      BACKGROUND_CONTEXT,
    )
  if (command === 'message') {
    const thread = await host.mainThread('xiaoya', BACKGROUND_CONTEXT)
    return host.grove!.sendMessage({ threadId: thread.id }, input, BACKGROUND_CONTEXT)
  }
  if (command === 'thread') return host.conversations.get(input.id, BACKGROUND_CONTEXT)
  if (command === 'snapshot') return host.conversations.snapshot(input.id, BACKGROUND_CONTEXT)
  if (command === 'request') {
    const thread = await host.mainThread('xiaoya', BACKGROUND_CONTEXT)
    return host.grove!.requestTask({ threadId: thread.id }, input, BACKGROUND_CONTEXT)
  }
  if (command === 'private') {
    await fixture.memories.create({ scope: 'global', content: 'BOB_PRIVATE_MEMORY' })
    await host.bots!.update('coder', { instructions: 'BOB_TARGET_INSTRUCTIONS' })
    const thread = await host.mainThread('coder', BACKGROUND_CONTEXT)
    const receipt = await host.conversations.submit(
      thread.id,
      { type: 'input', requestId: 'private-chat', content: 'BOB_PRIVATE_CHAT' },
      BACKGROUND_CONTEXT,
    )
    await (
      await host.engine.submission(thread.id, receipt.submissionId, BACKGROUND_CONTEXT)
    ).wait(BACKGROUND_CONTEXT)
    fixture.requests.length = 0
    return thread.id
  }
  if (command === 'close') return fixture.close()
  throw new Error('Unknown Host test command')
}
