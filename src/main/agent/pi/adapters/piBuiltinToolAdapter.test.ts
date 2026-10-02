import { expect, test } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

import { ToolRegistry } from '@/main/tools/toolRegistry'
import { registerPiBuiltinTools } from './piBuiltinToolAdapter'

test('registers Pi built-ins as product tools and creates cwd-scoped adapters', () => {
  const registry = new ToolRegistry()
  registerPiBuiltinTools(registry, process.cwd())

  expect(registry.list().map(({ name }) => name)).toEqual(['read', 'bash', 'edit', 'write'])

  const tools = registry.resolve<{ name: string }>('pi', ['read', 'write'], { cwd: process.cwd() })
  expect(tools.map(({ name }) => name)).toEqual(['read', 'write'])
})

test('reports creation and updates only after writing the real file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-write-'))
  try {
    const registry = new ToolRegistry()
    registerPiBuiltinTools(registry, root)
    const [tool] = registry.resolve<ToolDefinition<any, any, any>>('pi', ['write'], { cwd: root })
    const first = await tool!.execute('first', { path: 'README.md', content: '# First' }, undefined, undefined, {} as any)
    expect(first.details).toMatchObject({ created: true, updated: false })
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# First')
    const second = await tool!.execute('second', { path: 'README.md', content: '# Second' }, undefined, undefined, {} as any)
    expect(second.details).toMatchObject({ created: false, updated: true })
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# Second')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
