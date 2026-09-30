import { expect, test, vi } from 'vitest'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import { createKnowledgeTools, registerPiKnowledgeTools } from './piKnowledgeToolAdapter'

test('registers both Knowledge tools for each Pi runtime and preserves citations through search and read', async () => {
  const citation = {
    documentId: 'doc',
    sourceId: 'source',
    sourceName: 'Documents',
    filePath: '/architecture.pdf',
    title: 'architecture.pdf',
    page: 18,
  }
  const chunk = {
    id: 'child',
    documentId: 'doc',
    sourceId: 'source',
    parentId: 'parent',
    content: 'Isolation',
    contextualContent: 'Isolation',
    ordinal: 1,
    citation,
    metadata: {},
  }
  const context = {
    ...chunk,
    id: 'parent',
    parentId: undefined,
    content: 'Separate processes protect the UI from crashes.',
  }
  const service = {
    search: vi.fn(async () => [
      { chunk, score: 1, citationUrl: 'https://knowledge.local/chunks/child' },
    ]),
    read: vi.fn(async () => ({
      chunk,
      context,
      adjacent: [],
      citationUrl: 'https://knowledge.local/chunks/child',
    })),
  }
  const registry = new ToolRegistry()
  registerPiKnowledgeTools(registry, () => service)
  const tools = registry.resolve<ReturnType<typeof createKnowledgeTools>[number]>(
    'pi',
    ['search_knowledge', 'read_knowledge'],
    { cwd: '/workspace' },
  )
  const search = tools[0] as ReturnType<typeof createKnowledgeTools>[0]
  const controller = new AbortController()
  const result = await search.execute(
    'search-call',
    { query: 'isolation', limit: 6 },
    controller.signal,
    undefined,
    {} as never,
  )
  expect(service.search).toHaveBeenCalledWith({ query: 'isolation', limit: 6 }, controller.signal)
  expect(result.content[0]).toMatchObject({
    text: expect.stringContaining(
      '[architecture.pdf · Page 18](https://knowledge.local/chunks/child)',
    ),
  })
  expect(result.details.results[0].chunk.id).toBe('child')
  const read = tools[1] as ReturnType<typeof createKnowledgeTools>[1]
  const expanded = await read.execute(
    'read-call',
    { chunkId: 'child' },
    undefined,
    undefined,
    {} as never,
  )
  expect(expanded.content[0]).toMatchObject({
    text: expect.stringContaining('Separate processes protect'),
  })
  expect(expanded.details.context.citation.page).toBe(18)
  const subagentTools = registry.resolve('pi', ['search_knowledge', 'read_knowledge'], {
    cwd: '/child-workspace',
  })
  expect(subagentTools).toHaveLength(2)
})

test('aborted reads never call the knowledge service', async () => {
  const service = { search: vi.fn(), read: vi.fn() }
  const [, read] = createKnowledgeTools(() => service)
  const controller = new AbortController()
  controller.abort()
  await expect(
    read.execute('read-call', { chunkId: 'child' }, controller.signal, undefined, {} as never),
  ).rejects.toThrow()
  expect(service.read).not.toHaveBeenCalled()
})
