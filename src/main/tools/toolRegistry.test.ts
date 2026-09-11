import { expect, test } from 'vitest'

import { ToolRegistry } from './toolRegistry'

const definition = {
  name: 'read',
  label: 'Read',
  description: 'Read a file',
  parameters: { type: 'object' },
}

test('registers product definitions and resolves runtime adapters', () => {
  const registry = new ToolRegistry()
  registry.register({
    definition,
    adapter: { runtime: 'pi', create: ({ cwd }) => ({ name: 'read', cwd }) },
  })

  expect(registry.get('read')).toEqual(definition)
  expect(registry.list()).toEqual([definition])
  expect(registry.resolve<{ name: string; cwd: string }>('pi', ['read'], { cwd: '/repo' })).toEqual(
    [{ name: 'read', cwd: '/repo' }],
  )
})

test('rejects duplicate, unknown, and unsupported tool registrations', () => {
  const registry = new ToolRegistry()
  registry.register({ definition, adapter: { runtime: 'pi', create: () => ({}) } })

  expect(() =>
    registry.register({ definition, adapter: { runtime: 'pi', create: () => ({}) } }),
  ).toThrow('Tool already registered: read')
  expect(() => registry.resolve('pi', ['missing'], { cwd: '/repo' })).toThrow(
    'Unknown tool: missing',
  )
  expect(() => registry.resolve('other', ['read'], { cwd: '/repo' })).toThrow(
    'Tool "read" does not support runtime "other"',
  )
})
