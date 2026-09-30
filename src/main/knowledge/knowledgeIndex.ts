import { createClient, type Client, type InStatement } from '@libsql/client'
import type { KnowledgeChunk } from '@/shared/knowledge/knowledge'

export function searchTerms(text: string): string[] {
  const words =
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}_]+/gu) ?? []
  return words.flatMap((word) => {
    const parts =
      word.match(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu,
      ) ?? []
    return parts.flatMap((part) =>
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(part)
        ? Array.from(part).flatMap((character, index, chars) =>
            index + 1 < chars.length
              ? [`${character}${chars[index + 1]}`]
              : chars.length === 1
                ? [character]
                : [],
          )
        : [part, ...part.split('_').filter((term) => term !== part)],
    )
  })
}

export class KnowledgeIndex {
  private readonly client: Client

  constructor(url: string) {
    this.client = createClient({ url })
  }

  async initialize(): Promise<void> {
    await this.client.executeMultiple(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, source_id TEXT NOT NULL,
        parent_id TEXT, ordinal INTEGER NOT NULL, model TEXT NOT NULL,
        chunk TEXT NOT NULL, embedding BLOB
      );
      CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks(document_id);
      CREATE INDEX IF NOT EXISTS chunks_source_model_idx ON chunks(source_id, model);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, content);
    `)
  }

  async replaceDocument(
    documentId: string,
    chunks: KnowledgeChunk[],
    vectors: number[][],
    model: string,
  ): Promise<void> {
    const children = chunks.filter((chunk) => chunk.parentId)
    if (vectors.length !== children.length)
      throw new Error('Embedding count does not match child chunks')
    const dimension = vectors[0]?.length
    if (
      vectors.some(
        (vector) =>
          !dimension ||
          vector.length !== dimension ||
          vector.some((value) => !Number.isFinite(value)) ||
          vector.every((value) => value === 0),
      )
    )
      throw new Error('Invalid embedding vectors')
    const statements: InStatement[] = [
      {
        sql: 'DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE document_id = ?)',
        args: [documentId],
      },
      { sql: 'DELETE FROM chunks WHERE document_id = ?', args: [documentId] },
    ]
    let vectorIndex = 0
    for (const chunk of chunks) {
      statements.push({
        sql: `INSERT INTO chunks (id, document_id, source_id, parent_id, ordinal, model, chunk, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ${chunk.parentId ? 'vector32(?)' : '?'})`,
        args: [
          chunk.id,
          documentId,
          chunk.sourceId,
          chunk.parentId ?? null,
          chunk.ordinal,
          model,
          JSON.stringify(chunk),
          chunk.parentId ? JSON.stringify(vectors[vectorIndex++]) : null,
        ],
      })
      if (chunk.parentId)
        statements.push({
          sql: 'INSERT INTO chunks_fts (id, content) VALUES (?, ?)',
          args: [chunk.id, searchTerms(chunk.contextualContent).join(' ')],
        })
    }
    await this.client.batch(statements, 'write')
  }

  async removeDocument(documentId: string): Promise<void> {
    await this.client.batch(
      [
        {
          sql: 'DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE document_id = ?)',
          args: [documentId],
        },
        { sql: 'DELETE FROM chunks WHERE document_id = ?', args: [documentId] },
      ],
      'write',
    )
  }

  async removeSource(sourceId: string): Promise<void> {
    await this.client.batch(
      [
        {
          sql: 'DELETE FROM chunks_fts WHERE id IN (SELECT id FROM chunks WHERE source_id = ?)',
          args: [sourceId],
        },
        { sql: 'DELETE FROM chunks WHERE source_id = ?', args: [sourceId] },
      ],
      'write',
    )
  }

  async get(id: string): Promise<KnowledgeChunk | undefined> {
    const result = await this.client.execute({
      sql: 'SELECT chunk FROM chunks WHERE id = ?',
      args: [id],
    })
    return result.rows[0] ? (JSON.parse(String(result.rows[0].chunk)) as KnowledgeChunk) : undefined
  }

  async adjacent(parent: KnowledgeChunk): Promise<KnowledgeChunk[]> {
    const results = await Promise.all([
      this.client.execute({
        sql: 'SELECT chunk FROM chunks WHERE document_id = ? AND parent_id IS NOT NULL AND ordinal < ? ORDER BY ordinal DESC LIMIT 1',
        args: [parent.documentId, parent.ordinal],
      }),
      this.client.execute({
        sql: 'SELECT chunk FROM chunks WHERE document_id = ? AND parent_id IS NOT NULL AND ordinal > (SELECT MAX(ordinal) FROM chunks WHERE parent_id = ?) ORDER BY ordinal LIMIT 1',
        args: [parent.documentId, parent.id],
      }),
    ])
    return results
      .flatMap((result) =>
        result.rows.map((row) => JSON.parse(String(row.chunk)) as KnowledgeChunk),
      )
      .filter((chunk) => chunk.citation.heading === parent.citation.heading)
  }

  async lexical(
    query: string,
    sourceIds: string[],
    model: string,
    limit = 40,
  ): Promise<KnowledgeChunk[]> {
    const terms = [...new Set(searchTerms(query))].slice(0, 64)
    if (!terms.length || !sourceIds.length) return []
    const result = await this.client.execute({
      sql: `SELECT c.chunk FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.id WHERE chunks_fts MATCH ? AND c.model = ? AND c.source_id IN (${sourceIds.map(() => '?').join(',')}) ORDER BY bm25(chunks_fts) LIMIT ?`,
      args: [terms.map((term) => `"${term}"`).join(' OR '), model, ...sourceIds, limit],
    })
    return result.rows.map((row) => JSON.parse(String(row.chunk)) as KnowledgeChunk)
  }

  async vector(
    vector: number[],
    sourceIds: string[],
    model: string,
    limit = 40,
  ): Promise<KnowledgeChunk[]> {
    if (!sourceIds.length) return []
    if (
      !vector.length ||
      vector.some((value) => !Number.isFinite(value)) ||
      vector.every((value) => value === 0)
    )
      throw new Error('Invalid query embedding')
    const result = await this.client.execute({
      sql: `SELECT chunk FROM chunks WHERE embedding IS NOT NULL AND model = ? AND source_id IN (${sourceIds.map(() => '?').join(',')}) ORDER BY vector_distance_cos(embedding, vector32(?)) LIMIT ?`,
      args: [model, ...sourceIds, JSON.stringify(vector), limit],
    })
    return result.rows.map((row) => JSON.parse(String(row.chunk)) as KnowledgeChunk)
  }

  close(): void {
    this.client.close()
  }
}
