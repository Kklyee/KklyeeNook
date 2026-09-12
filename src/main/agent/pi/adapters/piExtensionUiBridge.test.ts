import { expect, test } from 'vitest'

import { createPiExtensionUiBridge } from './piExtensionUiBridge'

test('round-trips a blocking Pi select request through the client response', async () => {
  const requested: string[] = []
  const resolved: string[] = []
  const bridge = createPiExtensionUiBridge({
    nextRequestId: () => 'request-1',
    currentToolCallId: () => 'tool-1',
    onRequest: (request) => requested.push(request.id),
    onResolved: (requestId) => resolved.push(requestId),
  })

  const answer = bridge.ui.select('Permission', ['Allow once', 'Deny'])

  expect(bridge.pending()).toMatchObject([
    { id: 'request-1', kind: 'select', toolCallId: 'tool-1' },
  ])
  expect(bridge.respond({ requestId: 'request-1', value: 'Allow once' })).toBe(true)
  await expect(answer).resolves.toBe('Allow once')
  expect(requested).toEqual(['request-1'])
  expect(resolved).toEqual(['request-1'])
  expect(bridge.pending()).toEqual([])
})
