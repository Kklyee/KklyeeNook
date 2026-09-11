import { expect, test } from 'vitest'

import { createArtifactToolDefinition } from './piArtifactToolAdapter'

test('create_artifact exposes an object-shaped provider tool schema', () => {
  const tool = createArtifactToolDefinition()

  expect(tool.parameters).toMatchObject({ type: 'object' })
})
