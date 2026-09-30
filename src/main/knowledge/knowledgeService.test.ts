import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { connectDatabase } from '@/main/db/client'
import { KnowledgeRepo } from '@/main/db/repositories/knowledgeRepo'
import { CodeParser, TextParser } from './documentParser'
import { KnowledgeIndex, searchTerms } from './knowledgeIndex'
import { KnowledgeService, reciprocalRankFusion } from './knowledgeService'
import type { KnowledgeChunk } from '@/shared/knowledge/knowledge'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function setup(model = 'test-model') {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-index-'))
  const { database, close } = await connectDatabase('file::memory:', fileURLToPath(new URL('../../../drizzle', import.meta.url)))
  const index = new KnowledgeIndex('file::memory:')
  await index.initialize()
  const repo = new KnowledgeRepo(database)
  const models = {
    embed: vi.fn(async (texts: string[]) => texts.map((text) => text.includes('isolation') || text.includes('独立进程') ? [1, 0] : [0, 1])),
    rerank: vi.fn(async (_query: string, texts: string[]) => texts.map((text) => text.includes('crash') ? 10 : text.includes('isolation') ? 5 : 1)),
  }
  const service = new KnowledgeService(repo, index, [new TextParser(), new CodeParser()], models, model)
  cleanups.push(async () => { await service.stop(); index.close(); close(); await rm(directory, { recursive: true, force: true }) })
  return { directory, service, repo, index, models }
}

test('indexes incrementally, updates changed files, removes deleted files and excludes generated folders', async () => {
  const { directory, service, repo, index, models } = await setup()
  await writeFile(join(directory, 'architecture.md'), '# Agent\n\nProcess isolation protects the UI from a crash.')
  await mkdir(join(directory, 'node_modules'))
  await writeFile(join(directory, 'node_modules', 'ignored.ts'), 'export class Ignored {}')
  const source = await service.addSource(directory, 'workspace')
  await service.waitForIdle()
  expect(await repo.getSource(source.id)).toMatchObject({ status: 'ready', documentCount: 1, chunkCount: 1, embeddingModel: 'test-model', error: null })
  const first = (await service.search({ query: 'isolation' }))[0]
  expect(first.chunk.citation).toMatchObject({ sourceId: source.id, heading: 'Agent', lineStart: 1, lineEnd: 3 })
  const calls = models.embed.mock.calls.length
  await service.start()
  await service.waitForIdle()
  expect(models.embed.mock.calls).toHaveLength(calls)
  await writeFile(join(directory, 'architecture.md'), '# Agent\n\nProcess isolation updated for security.')
  await service.reindex(source.id)
  await service.waitForIdle()
  expect(await index.get(first.chunk.id)).toBeUndefined()
  expect((await service.search({ query: 'security' }))[0].chunk.content).toContain('updated')
  await rm(join(directory, 'architecture.md'))
  await service.reindex(source.id)
  await service.waitForIdle()
  expect(await repo.getSource(source.id)).toMatchObject({ status: 'ready', documentCount: 0, chunkCount: 0 })
  expect(await service.search({ query: 'isolation' })).toEqual([])
})

test('combines BM25 and vectors, reranks candidates and expands parents with source filters', async () => {
  const { directory, service, repo, models } = await setup()
  await writeFile(join(directory, 'architecture.md'), '# Architecture\n\nSeparate process isolation protects the UI from a crash.\n\n## Cooking\n\nApples are delicious.')
  await writeFile(join(directory, 'agent.ts'), 'export class AgentBackend {\n  startWorker() { return "isolation" }\n}')
  const docs = await service.addSource(join(directory, 'architecture.md'), 'file')
  const code = await service.addSource(join(directory, 'agent.ts'), 'file')
  await service.waitForIdle()
  const results = await service.search({ query: 'AgentBackend isolation', limit: 3 })
  expect(results[0].chunk.content).toContain('crash')
  expect(new Set(results.map((result) => result.chunk.sourceId))).toEqual(new Set([docs.id, code.id]))
  expect(models.rerank).toHaveBeenCalled()
  const read = await service.read(results[0].chunk.id)
  expect(read.context.id).toBe(results[0].chunk.parentId)
  expect(read.context.content).toContain('crash')
  expect(read.citationUrl).toContain(results[0].chunk.id)
  expect((await service.search({ query: 'isolation', sourceIds: [code.id] })).every((result) => result.chunk.sourceId === code.id)).toBe(true)
  expect(await service.search({ query: 'isolation', sourceIds: [] })).toEqual([])
  await service.removeSource(code.id)
  expect(await repo.listDocuments(code.id)).toEqual([])
  expect((await service.search({ query: 'isolation' })).every((result) => result.chunk.sourceId !== code.id)).toBe(true)
})

test('supports Chinese BM25 and safely treats punctuation as literal query text', async () => {
  const { directory, service, index } = await setup()
  await writeFile(join(directory, '中文.md'), '# 架构\n\n独立进程避免界面受到影响。')
  const source = await service.addSource(directory, 'folder')
  await service.waitForIdle()
  expect(searchTerms('独立进程')).toEqual(['独立', '立进', '进程'])
  expect(await index.lexical('为什么独立进程', [source.id], 'test-model')).toHaveLength(1)
  await expect(service.search({ query: '" OR * - (独立进程)' })).resolves.toHaveLength(1)
})

test('marks indexing errors, retries successfully and detects incompatible embedding models', async () => {
  const { directory, service, repo, models } = await setup()
  await writeFile(join(directory, 'report.txt'), 'Process isolation')
  models.embed.mockRejectedValueOnce(new Error('Model unavailable'))
  const source = await service.addSource(directory, 'folder')
  await service.waitForIdle()
  expect(await repo.getSource(source.id)).toMatchObject({ status: 'error', documentCount: 0, error: expect.stringContaining('Model unavailable') })
  await service.reindex(source.id)
  await service.waitForIdle()
  await repo.updateSource(source.id, { embeddingModel: 'other-model' })
  await expect(service.search({ query: 'isolation' })).rejects.toThrow('Reindex')
  await expect(service.search({ query: '' })).rejects.toThrow('required')
  await expect(service.search({ query: 'a', limit: 21 })).rejects.toThrow('between')
  const controller = new AbortController()
  controller.abort()
  await repo.updateSource(source.id, { embeddingModel: 'test-model' })
  await expect(service.search({ query: 'a' }, controller.signal)).rejects.toThrow()
})

test('RRF favors candidates present in both rankings', () => {
  const a = { id: 'a' } as KnowledgeChunk
  const b = { id: 'b' } as KnowledgeChunk
  const c = { id: 'c' } as KnowledgeChunk
  expect(reciprocalRankFusion([[a, b], [c, b]]).map((chunk) => chunk.id)).toEqual(['b', 'a', 'c'])
})
