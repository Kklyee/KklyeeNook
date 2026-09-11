import { expect, test } from 'vitest'

import { ToolRegistry } from '@/main/tools/toolRegistry'
import { registerPiBuiltinTools } from './piBuiltinToolAdapter'

test('registers Pi built-ins as product tools and creates cwd-scoped adapters', () => {
  const registry = new ToolRegistry()
  registerPiBuiltinTools(registry, process.cwd())

  expect(registry.list().map(({ name }) => name)).toEqual(['read', 'bash', 'edit', 'write'])

  const tools = registry.resolve<{ name: string }>('pi', ['read', 'write'], {
    cwd: process.cwd(),
  })
  expect(tools.map(({ name }) => name)).toEqual(['read', 'write'])
})
