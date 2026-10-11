import { expect, test } from 'vitest'

import { ToolRegistry } from './toolRegistry'

const definition = {
  name: 'read',
  label: 'Read',
  description: 'Read a file',
  inputSchema: { type: 'object' },
}

test('registers product definitions and resolves scoped tools', () => {
  const registry = new ToolRegistry()
  const dispose = registry.register({
    definition,
    adapter: { create: ({ cwd }) => ({ name: 'read', cwd }) },
  })

  expect(registry.get('read')).toEqual(definition)
  expect(registry.list()).toEqual([definition])
  expect(registry.resolve<{ name: string; cwd: string }>(['read'], { cwd: '/repo' })).toEqual(
    [{ name: 'read', cwd: '/repo' }],
  )

  dispose()
  expect(registry.get('read')).toBeUndefined()
  expect(registry.getRevision()).toBe(2)
})

test('rejects duplicate and unknown tool registrations', () => {
  const registry = new ToolRegistry()
  registry.register({ definition, adapter: { create: () => ({}) } })

  expect(() =>
    registry.register({ definition, adapter: { create: () => ({}) } }),
  ).toThrow('Tool already registered: read')
  expect(() => registry.resolve(['missing'], { cwd: '/repo' })).toThrow(
    'Unknown tool: missing',
  )
})

test('requires an input schema for every registered tool', () => {
  const registry = new ToolRegistry()
  expect(() => registry.register({ definition: { ...definition, inputSchema: undefined }, adapter: { create: () => ({}) } })).toThrow('Tool input schema is required: read')
})
