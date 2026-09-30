import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { KnowledgeSource } from '@/shared/knowledge/knowledge'

export const knowledgeSources = sqliteTable(
  'knowledge_sources',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    kind: text('kind').$type<KnowledgeSource['kind']>().notNull(),
    status: text('status').$type<KnowledgeSource['status']>().notNull(),
    documentCount: integer('document_count').notNull().default(0),
    chunkCount: integer('chunk_count').notNull().default(0),
    lastIndexed: integer('last_indexed'),
    embeddingModel: text('embedding_model'),
    error: text('error'),
  },
  (table) => [uniqueIndex('knowledge_source_path_idx').on(table.path)],
)

export const knowledgeDocuments = sqliteTable(
  'knowledge_documents',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    title: text('title').notNull(),
    contentHash: text('content_hash').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    chunkCount: integer('chunk_count').notNull(),
    indexedAt: integer('indexed_at').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index('knowledge_document_source_idx').on(table.sourceId),
    uniqueIndex('knowledge_document_path_idx').on(table.sourceId, table.filePath),
  ],
)
