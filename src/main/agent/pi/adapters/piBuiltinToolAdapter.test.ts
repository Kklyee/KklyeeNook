import { expect, test } from 'vitest'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecutableTool } from '@/main/tools/executable-tool'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import { registerPiBuiltinTools } from './piBuiltinToolAdapter'

test('registers Pi built-ins as product tools and creates cwd-scoped adapters', () => {
  const registry = new ToolRegistry()
  registerPiBuiltinTools(registry, process.cwd())

  expect(registry.list().map(({ name }) => name)).toEqual([
    'read',
    'find',
    'grep',
    'bash',
    'edit',
    'write',
  ])

  const tools = registry.resolve<{ name: string }>('pi', ['read', 'find', 'grep', 'write'], {
    cwd: process.cwd(),
  })
  expect(tools.map(({ name }) => name)).toEqual(['read', 'find', 'grep', 'write'])
  expect(registry.get('bash')?.label).toBe('Shell')
  if (process.platform === 'win32') {
    expect(registry.get('bash')?.description).toContain('PowerShell 7')
    const [shell] = registry.resolve<ExecutableTool>('pi', ['bash'], { cwd: process.cwd() })
    expect(shell?.promptSnippet).toContain('PowerShell 7')
    expect(shell?.promptGuidelines?.join('\n')).toContain('native Windows paths')
  }
})

test('reports creation and updates only after writing the real file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-write-'))
  try {
    const registry = new ToolRegistry()
    registerPiBuiltinTools(registry, root)
    const [tool] = registry.resolve<ExecutableTool>('pi', ['write'], { cwd: root })
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

test('reads text offsets exactly and returns images as attachments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-read-'))
  try {
    await writeFile(join(root, 'notes.txt'), 'a\nb\nc\n')
    await writeFile(
      join(root, 'pixel.jpg'),
      Buffer.from('/9j/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64'),
    )
    const registry = new ToolRegistry()
    registerPiBuiltinTools(registry, root)
    const [read] = registry.resolve<ExecutableTool>('pi', ['read'], { cwd: root })

    await expect(read!.execute('offset', { path: join(root, 'notes.txt'), offset: 2, limit: 2 })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'b\nc' }],
    })
    const image = await read!.execute('image', { path: join(root, 'pixel.jpg') })
    expect(image.content[0]).toMatchObject({ type: 'image', mimeType: 'image/webp' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('edits unique non-overlapping replacements and returns diff details', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-edit-'))
  try {
    const path = join(root, 'file.txt')
    await writeFile(path, 'alpha\nbeta\ngamma\n')
    const registry = new ToolRegistry()
    registerPiBuiltinTools(registry, root)
    const [edit] = registry.resolve<ExecutableTool>('pi', ['edit'], { cwd: root })

    const result = await edit!.execute('edit', {
      path,
      edits: [
        { oldText: 'alpha', newText: 'one' },
        { oldText: 'gamma', newText: 'three' },
      ],
    })
    expect(await readFile(path, 'utf8')).toBe('one\nbeta\nthree\n')
    expect(result.details).toMatchObject({ firstChangedLine: 1 })
    expect(JSON.stringify(result.details)).toContain('-alpha')

    await expect(edit!.execute('missing', { path, edits: [{ oldText: 'absent', newText: 'x' }] })).rejects.toThrow()
    await writeFile(path, 'abcde\n')
    await expect(
      edit!.execute('overlap', {
        path,
        edits: [
          { oldText: 'bcd', newText: 'x' },
          { oldText: 'cd', newText: 'y' },
        ],
      }),
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('find and grep do not traverse symlinked directories outside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-search-'))
  const outside = await mkdtemp(join(tmpdir(), 'nook-outside-'))
  try {
    await writeFile(join(root, 'inside.txt'), 'visible needle\n')
    await writeFile(join(outside, 'secret.txt'), 'secret needle\n')
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const registry = new ToolRegistry()
    registerPiBuiltinTools(registry, root)
    const [find, grep] = registry.resolve<ExecutableTool>('pi', ['find', 'grep'], { cwd: root })

    const found = await find!.execute('find', { path: root, pattern: '**/*.txt' })
    expect(found.content[0]).toMatchObject({ text: expect.stringContaining('inside.txt') })
    expect(found.content[0]).toMatchObject({ text: expect.not.stringContaining('secret.txt') })

    const searched = await grep!.execute('grep', { path: root, pattern: 'needle', literal: true })
    expect(searched.content[0]).toMatchObject({ text: expect.stringContaining('visible needle') })
    expect(searched.content[0]).toMatchObject({ text: expect.not.stringContaining('secret needle') })
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
