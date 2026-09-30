export interface KnowledgeFile {
  path: string
  name: string
}

export interface DocumentBlock {
  kind: 'heading' | 'paragraph' | 'table' | 'list' | 'code' | 'image'
  content: string
  level?: number
  page?: number
  pageEnd?: number
  lineStart?: number
  lineEnd?: number
  metadata: Record<string, unknown>
}

export interface ParsedDocument {
  title: string
  sections: Array<{ title: string; level: number; blockIndex: number }>
  paragraphs: DocumentBlock[]
  tables: DocumentBlock[]
  pages: number[]
  blocks: DocumentBlock[]
  metadata: Record<string, unknown>
}

export interface KnowledgeCitation {
  documentId: string
  sourceId: string
  sourceName: string
  filePath: string
  title: string
  heading?: string
  page?: number
  pageEnd?: number
  lineStart?: number
  lineEnd?: number
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  sourceId: string
  content: string
  contextualContent: string
  parentId?: string
  ordinal: number
  citation: KnowledgeCitation
  metadata: Record<string, unknown>
}

export interface KnowledgeSource {
  workspaceId?: string | null
  workspaceRelativePath?: string | null
  id: string
  name: string
  path: string
  kind: 'file' | 'folder' | 'workspace'
  status: 'pending' | 'indexing' | 'ready' | 'error'
  documentCount: number
  chunkCount: number
  lastIndexed: number | null
  embeddingModel: string | null
  error: string | null
}

export interface KnowledgeDocument {
  id: string
  sourceId: string
  filePath: string
  title: string
  contentHash: string
  embeddingModel: string
  chunkCount: number
  indexedAt: number
  metadata: Record<string, unknown>
}

export interface KnowledgeSearchRequest {
  workspaceId?: string
  query: string
  sourceIds?: string[]
  limit?: number
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk
  score: number
  citationUrl: string
}

export interface KnowledgeReadResult {
  chunk: KnowledgeChunk
  context: KnowledgeChunk
  adjacent: KnowledgeChunk[]
  citationUrl: string
}

export interface KnowledgeSettings {
  embeddingModel: string
  rerankModel: string
}

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  embeddingModel: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  rerankModel: 'Xenova/bge-reranker-base',
}

export function knowledgeCitationUrl(chunkId: string): string {
  return `https://knowledge.local/chunks/${encodeURIComponent(chunkId)}`
}

export function knowledgeCitationLabel(citation: KnowledgeCitation): string {
  const location = citation.page
    ? ` · Page ${citation.page}${citation.pageEnd && citation.pageEnd !== citation.page ? `–${citation.pageEnd}` : ''}`
    : citation.lineStart
      ? ` · L${citation.lineStart}–L${citation.lineEnd ?? citation.lineStart}`
      : citation.heading
        ? ` · ${citation.heading}`
        : ''
  return `${citation.title}${location}`
}
