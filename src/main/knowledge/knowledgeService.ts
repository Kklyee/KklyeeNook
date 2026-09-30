import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { KnowledgeRepo } from '@/main/db/repositories/knowledgeRepo'
import {
  knowledgeCitationUrl,
  type KnowledgeChunk,
  type KnowledgeReadResult,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
  type KnowledgeSource,
} from '@/shared/knowledge/knowledge'
import { chunkDocument } from './chunkDocument'
import { supportsKnowledgeFile, type DocumentParser } from './documentParser'
import type { KnowledgeIndex } from './knowledgeIndex'
import type { KnowledgeModels } from './knowledgeModels'

const ignoredDirectories = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  'out',
  'dist',
  'build',
  '.next',
  'target',
  '.idea',
  '.vscode',
  '.cache',
  '.knowledge-venv',
])

export class KnowledgeService {
  private queue: Promise<void> = Promise.resolve()
  private readonly scheduled = new Set<string>()
  private interval?: ReturnType<typeof setInterval>
  private stopped = false

  constructor(
    private readonly repo: KnowledgeRepo,
    private readonly index: KnowledgeIndex,
    private readonly parsers: DocumentParser[],
    private readonly models: KnowledgeModels,
    private readonly embeddingModel: string,
  ) {}

  listSources(): Promise<KnowledgeSource[]> {
    return this.repo.listSources()
  }

  assertCanReload(): void {
    if (this.scheduled.size)
      throw new Error(
        'Knowledge is indexing. Wait for indexing to finish before changing settings.',
      )
  }

  async addSource(path: string, kind: KnowledgeSource['kind']): Promise<KnowledgeSource> {
    const canonicalPath = await realpath(path)
    const info = await stat(canonicalPath)
    if (
      kind === 'file'
        ? !info.isFile() || !supportsKnowledgeFile(canonicalPath)
        : !info.isDirectory()
    )
      throw new Error('Unsupported Knowledge source')
    const sources = await this.repo.listSources()
    const existing = sources.find((source) => samePath(source.path, canonicalPath))
    if (existing) return existing
    const source: KnowledgeSource = {
      id: randomUUID(),
      name:
        kind === 'workspace' ? `Workspace · ${basename(canonicalPath)}` : basename(canonicalPath),
      path: canonicalPath,
      kind,
      status: 'pending',
      documentCount: 0,
      chunkCount: 0,
      lastIndexed: null,
      embeddingModel: null,
      error: null,
    }
    await this.repo.saveSource(source)
    this.schedule(source.id, false)
    return source
  }

  async reindex(sourceId: string): Promise<void> {
    await this.repo.getSource(sourceId)
    await this.repo.updateSource(sourceId, { status: 'pending', error: null })
    this.schedule(sourceId, true)
  }

  async removeSource(sourceId: string): Promise<void> {
    await this.enqueue(async () => {
      await this.repo.getSource(sourceId)
      await this.index.removeSource(sourceId)
      await this.repo.deleteSource(sourceId)
    })
  }

  async start(): Promise<void> {
    for (const source of await this.repo.listSources()) this.schedule(source.id, false)
    this.interval = setInterval(() => {
      void this.repo
        .listSources()
        .then((sources) => {
          for (const source of sources)
            if (source.status !== 'error') this.schedule(source.id, false)
        })
        .catch((error) => console.error('Knowledge refresh failed', error))
    }, 30_000)
    this.interval.unref()
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearInterval(this.interval)
    await this.queue
  }

  async waitForIdle(): Promise<void> {
    await this.queue
  }

  async search(
    request: KnowledgeSearchRequest,
    signal?: AbortSignal,
  ): Promise<KnowledgeSearchResult[]> {
    const query = request.query.trim()
    if (!query) throw new Error('Knowledge query is required')
    const limit = request.limit ?? 6
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new Error('Knowledge limit must be between 1 and 20')
    if (request.sourceIds?.length === 0) return []
    const sources = (await this.repo.listSources()).filter(
      (source) => !request.sourceIds || request.sourceIds.includes(source.id),
    )
    if (
      sources.some(
        (source) => source.documentCount > 0 && source.embeddingModel !== this.embeddingModel,
      )
    )
      throw new Error('Embedding model changed. Reindex Knowledge sources before searching.')
    const sourceIds = sources.map((source) => source.id)
    if (!sourceIds.length || !sources.some((source) => source.chunkCount > 0)) return []
    signal?.throwIfAborted()
    const [queryVectors, lexical] = await Promise.all([
      this.models.embed([query], signal),
      this.index.lexical(query, sourceIds, this.embeddingModel),
    ])
    signal?.throwIfAborted()
    const vector = await this.index.vector(queryVectors[0], sourceIds, this.embeddingModel)
    const candidates = reciprocalRankFusion([lexical, vector]).slice(0, 40)
    if (!candidates.length) return []
    const scores = await this.models.rerank(
      query,
      candidates.map((chunk) => chunk.contextualContent),
      signal,
    )
    signal?.throwIfAborted()
    if (scores.length !== candidates.length || scores.some((score) => !Number.isFinite(score)))
      throw new Error('Invalid reranker scores')
    const seenParents = new Set<string>()
    return candidates
      .map((chunk, index) => ({
        chunk,
        score: scores[index],
        citationUrl: knowledgeCitationUrl(chunk.id),
      }))
      .sort((a, b) => b.score - a.score)
      .filter(({ chunk }) => {
        const parentId = chunk.parentId ?? chunk.id
        if (seenParents.has(parentId)) return false
        seenParents.add(parentId)
        return true
      })
      .slice(0, limit)
  }

  async read(chunkId: string): Promise<KnowledgeReadResult> {
    const chunk = await this.index.get(chunkId)
    if (!chunk) throw new Error('Knowledge chunk no longer exists. Search again after reindexing.')
    const context = chunk.parentId ? await this.index.get(chunk.parentId) : chunk
    if (!context) throw new Error('Knowledge parent chunk not found')
    return {
      chunk,
      context,
      adjacent: await this.index.adjacent(context),
      citationUrl: knowledgeCitationUrl(chunk.id),
    }
  }

  private schedule(sourceId: string, force: boolean): void {
    if (this.stopped || this.scheduled.has(sourceId)) return
    this.scheduled.add(sourceId)
    void this.enqueue(async () => {
      try {
        await this.syncSource(sourceId, force)
      } catch (error) {
        await this.repo.updateSource(sourceId, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        this.scheduled.delete(sourceId)
      }
    }).catch((error) => console.error('Knowledge indexing failed', error))
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async syncSource(sourceId: string, force: boolean): Promise<void> {
    const source = await this.repo.getSource(sourceId)
    const documents = await this.repo.listDocuments(sourceId)
    let paths: string[]
    try {
      paths = await collectFiles(source.path, source.kind === 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      paths = []
    }
    const present = new Set(paths)
    for (const document of documents) {
      if (!present.has(document.filePath)) {
        await this.index.removeDocument(document.id)
        await this.repo.deleteDocument(document.id)
      }
    }
    const errors: string[] = []
    let changed = documents.some((document) => !present.has(document.filePath))
    for (const filePath of paths) {
      if (this.stopped) break
      const existing = documents.find((document) => document.filePath === filePath)
      try {
        const hash = createHash('sha256')
          .update(await readFile(filePath))
          .digest('hex')
        if (
          !force &&
          existing?.contentHash === hash &&
          existing.embeddingModel === this.embeddingModel
        )
          continue
        changed = true
        await this.repo.updateSource(sourceId, { status: 'indexing', error: null })
        const file = { path: filePath, name: basename(filePath) }
        const parser = this.parsers.find((parser) => parser.supports(file))!
        const parsed = await parser.parse(file)
        if (!parsed.blocks.length) throw new Error('Document contains no readable content')
        const id = existing?.id ?? randomUUID()
        const chunks = chunkDocument(parsed, {
          documentId: id,
          sourceId,
          sourceName: source.name,
          filePath,
          title: parsed.title,
        })
        const children = chunks.filter((chunk) => chunk.parentId)
        const vectors: number[][] = []
        for (let offset = 0; offset < children.length; offset += 32)
          vectors.push(
            ...(await this.models.embed(
              children.slice(offset, offset + 32).map((chunk) => chunk.contextualContent),
            )),
          )
        const afterHash = createHash('sha256')
          .update(await readFile(filePath))
          .digest('hex')
        if (afterHash !== hash) throw new Error('File changed while indexing; reindex to retry')
        await this.index.replaceDocument(id, chunks, vectors, this.embeddingModel)
        await this.repo.saveDocument({
          id,
          sourceId,
          filePath,
          title: parsed.title,
          contentHash: hash,
          embeddingModel: this.embeddingModel,
          chunkCount: children.length,
          indexedAt: Date.now(),
          metadata: { ...parsed.metadata, sections: parsed.sections, pages: parsed.pages },
        })
      } catch (error) {
        errors.push(
          `${basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    const indexed = await this.repo.listDocuments(sourceId)
    await this.repo.updateSource(sourceId, {
      status: errors.length ? 'error' : this.stopped ? 'pending' : 'ready',
      error: errors.length ? errors.join('\n') : null,
      documentCount: indexed.length,
      chunkCount: indexed.reduce((sum, document) => sum + document.chunkCount, 0),
      lastIndexed: changed || !source.lastIndexed ? Date.now() : source.lastIndexed,
      embeddingModel: indexed.every((document) => document.embeddingModel === this.embeddingModel)
        ? this.embeddingModel
        : source.embeddingModel,
    })
  }
}

export function reciprocalRankFusion(rankings: KnowledgeChunk[][]): KnowledgeChunk[] {
  const fused = new Map<string, { chunk: KnowledgeChunk; score: number }>()
  for (const ranking of rankings)
    ranking.forEach((chunk, index) => {
      const entry = fused.get(chunk.id) ?? { chunk, score: 0 }
      entry.score += 1 / (60 + index + 1)
      fused.set(chunk.id, entry)
    })
  return [...fused.values()].sort((a, b) => b.score - a.score).map(({ chunk }) => chunk)
}

async function collectFiles(path: string, file: boolean): Promise<string[]> {
  if (file) {
    await stat(path)
    return [path]
  }
  const result: string[] = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.env')) continue
    const child = join(path, entry.name)
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name))
      result.push(...(await collectFiles(child, false)))
    else if (entry.isFile() && supportsKnowledgeFile(child)) result.push(child)
  }
  return result.sort()
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
