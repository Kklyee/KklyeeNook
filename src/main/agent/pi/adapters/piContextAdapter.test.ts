import { expect, test } from 'vitest'

import { toPiContextMessage } from './piContextAdapter'

test('injects memories through a hidden Pi context message', () => {
  const message = toPiContextMessage({
    attachments: [],
    memories: [
      {
        id: 'memory-1',
        scope: 'workspace',
        content: 'Run tests before editing more files',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  })

  expect(message).toMatchObject({
    customType: 'kklyeenook-context',
    display: false,
    details: { memories: [{ id: 'memory-1', scope: 'workspace' }] },
  })
  expect(message?.content).toContain('Run tests before editing more files')
})
