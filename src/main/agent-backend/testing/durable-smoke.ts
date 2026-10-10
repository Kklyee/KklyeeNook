import assert from 'node:assert/strict'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import { AssistantEntry, createRegistry } from '@earendil-works/pi-durable'
import { AgentEngine } from '../../agent/agent-engine'

export async function runDurableSmoke(databasePath: string) {
  const context = withAbortSignal(AbortSignal.timeout(15_000), BACKGROUND_CONTEXT)
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  faux.setResponses([fauxAssistantMessage('Durable smoke passed.')])
  const options = { models, registry: createRegistry(), settings: { extensions: [] } }
  const open = () => AgentEngine.open(databasePath, options, context)
  const request = {
    type: 'input',
    content: 'Reply to the smoke test.',
    requestId: 'm0-smoke',
  } as const
  const first = await open()
  let conversationId
  let submissionId
  let entryIds
  try {
    await assert.rejects(open(), /locked/)
    const root = await first.harness.root(context, {
      agent: { model: { provider: 'faux', modelId: 'faux-1' }, extensions: [], tools: [] },
    })
    conversationId = root.id
    const submission = await root.submit(request, context)
    submissionId = submission.id
    const settled = await submission.wait(context)
    assert.equal(settled.status, 'done')
    assert(settled.type === 'input' && settled.status === 'done')
    const answer = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context)
    assert.deepEqual(answer?.model?.[0]?.content, [{ type: 'text', text: 'Durable smoke passed.' }])
    await root.waitForIdle(context)
    entryIds = (await root.entries({ order: 'ascending' }, 100, undefined, context)).items.map(
      (entry) => entry.id,
    )
    assert.equal(faux.state.callCount, 1)
  } finally {
    await first.close()
  }
  const reopened = await open()
  try {
    const root = await reopened.harness.root(context)
    assert.equal(root.id, conversationId)
    const repeated = await root.submit(request, context)
    assert.equal(repeated.id, submissionId)
    assert.equal((await repeated.wait(context)).status, 'done')
    await reopened.harness.waitForIdle(context)
    assert.deepEqual(
      (await root.entries({ order: 'ascending' }, 100, undefined, context)).items.map(
        (entry) => entry.id,
      ),
      entryIds,
    )
    assert.equal(faux.state.callCount, 1)
    assert.equal((await reopened.harness.inspect(context)).tasks.length, 0)
    return {
      conversationId,
      submissionId,
      entryIds,
      modelCalls: faux.state.callCount,
      node: process.versions.node,
      electron: process.versions.electron,
    }
  } finally {
    await reopened.close()
  }
}
