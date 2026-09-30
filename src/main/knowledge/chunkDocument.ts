import { randomUUID } from 'node:crypto'
import type { DocumentBlock, KnowledgeChunk, KnowledgeCitation, ParsedDocument } from '@/shared/knowledge/knowledge'

export function estimateTokens(text: string): number {
  const wide = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  return Math.ceil(wide + (text.length - wide) / 4)
}

export function chunkDocument(document: ParsedDocument, citation: KnowledgeCitation): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = []
  const headings: string[] = []
  let section: DocumentBlock[] = []
  let heading = ''
  let ordinal = 0
  const make = (blocks: DocumentBlock[], parentId?: string): KnowledgeChunk => {
    const content = blocks.map((block) => block.content).join('\n\n')
    const pages = blocks.flatMap((block) => block.page ? [block.page, block.pageEnd ?? block.page] : [])
    const lines = blocks.flatMap((block) => block.lineStart ? [block.lineStart, block.lineEnd ?? block.lineStart] : [])
    return {
      id: randomUUID(), documentId: citation.documentId, sourceId: citation.sourceId,
      content, contextualContent: `Document: ${document.title}\n${heading ? `Section: ${heading}\n` : ''}\n${content}`,
      ...(parentId ? { parentId } : {}), ordinal: ordinal++,
      citation: { ...citation, ...(heading ? { heading } : {}), ...(pages.length ? { page: Math.min(...pages), pageEnd: Math.max(...pages) } : {}), ...(lines.length ? { lineStart: Math.min(...lines), lineEnd: Math.max(...lines) } : {}) },
      metadata: { spans: blocks.map(({ content: _content, ...location }) => location) },
    }
  }
  const flush = () => {
    for (const parentBlocks of pack(section, 1800)) {
      const parent = make(parentBlocks)
      chunks.push(parent)
      for (const childBlocks of pack(parentBlocks, 450)) chunks.push(make(childBlocks, parent.id))
    }
    section = []
  }
  for (const block of document.blocks) {
    if (block.kind === 'heading') {
      flush()
      headings.length = Math.max(0, (block.level ?? 1) - 1)
      headings.push(block.content)
      heading = headings.filter(Boolean).join(' / ')
    }
    section.push(...splitBlock(block, 450))
  }
  flush()
  return chunks
}

function pack(blocks: DocumentBlock[], tokens: number): DocumentBlock[][] {
  const groups: DocumentBlock[][] = []
  let group: DocumentBlock[] = []
  let size = 0
  for (const block of blocks) {
    const cost = estimateTokens(block.content) + 2
    if (group.length && size + cost > tokens) { groups.push(group); group = []; size = 0 }
    group.push(block)
    size += cost
  }
  if (group.length) groups.push(group)
  return groups
}

function splitBlock(block: DocumentBlock, maxTokens: number): DocumentBlock[] {
  if (estimateTokens(block.content) <= maxTokens) return [block]
  const parts: DocumentBlock[] = []
  const lines = block.content.split('\n')
  const header = block.kind === 'table' && lines[1]?.includes('---') ? lines.slice(0, 2).join('\n') : ''
  let buffer = ''
  let lineStart = 0
  const push = (lineEnd: number) => {
    if (!buffer) return
    parts.push({ ...block, content: buffer, ...(block.lineStart ? { lineStart: block.lineStart + lineStart, lineEnd: block.lineStart + lineEnd } : {}) })
    buffer = ''
  }
  lines.forEach((line, index) => {
    if (buffer && estimateTokens(`${buffer}\n${line}`) > maxTokens) { push(index - 1); lineStart = index; buffer = header && index > 1 ? header : '' }
    let piece = ''
    for (const character of line) {
      if (estimateTokens(`${buffer}\n${piece}${character}`) > maxTokens - 2) {
        if (piece) buffer += `${buffer ? '\n' : ''}${piece}`
        push(index)
        lineStart = index
        piece = ''
      }
      piece += character
    }
    if (piece) buffer += `${buffer ? '\n' : ''}${piece}`
  })
  push(lines.length - 1)
  return parts
}
