import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { DocumentBlock, KnowledgeFile, ParsedDocument } from '@/shared/knowledge/knowledge'
import type { KnowledgeWorker } from './knowledgeWorker'

export interface DocumentParser {
  supports(file: KnowledgeFile): boolean
  parse(file: KnowledgeFile): Promise<ParsedDocument>
}

const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.go', '.rs', '.c', '.h', '.cpp', '.cs', '.rb', '.php', '.swift', '.kt', '.sql', '.sh', '.ps1', '.vue', '.svelte'])
const textExtensions = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.log', '.rst'])
const complexExtensions = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm'])

export function supportsKnowledgeFile(path: string): boolean {
  const extension = extname(path).toLowerCase()
  return codeExtensions.has(extension) || textExtensions.has(extension) || complexExtensions.has(extension)
}

export function parsedDocument(title: string, blocks: DocumentBlock[], metadata: Record<string, unknown>, pages?: number[]): ParsedDocument {
  return {
    title,
    blocks,
    sections: blocks.flatMap((block, blockIndex) => block.kind === 'heading' ? [{ title: block.content, level: block.level ?? 1, blockIndex }] : []),
    paragraphs: blocks.filter((block) => block.kind === 'paragraph' || block.kind === 'code'),
    tables: blocks.filter((block) => block.kind === 'table'),
    pages: pages ?? [...new Set(blocks.flatMap((block) => block.page ? [block.page] : []))],
    metadata,
  }
}

export class TextParser implements DocumentParser {
  supports(file: KnowledgeFile): boolean {
    return textExtensions.has(extname(file.path).toLowerCase())
  }

  async parse(file: KnowledgeFile): Promise<ParsedDocument> {
    const text = await readFile(file.path, 'utf8')
    if (text.includes('\0')) throw new Error(`Binary file cannot be indexed as text: ${file.name}`)
    return parseText(file, text, false)
  }
}

export class CodeParser implements DocumentParser {
  supports(file: KnowledgeFile): boolean {
    return codeExtensions.has(extname(file.path).toLowerCase())
  }

  async parse(file: KnowledgeFile): Promise<ParsedDocument> {
    return parseText(file, await readFile(file.path, 'utf8'), true)
  }
}

export class DoclingParser implements DocumentParser {
  constructor(private readonly worker: Pick<KnowledgeWorker, 'request'>) {}

  supports(file: KnowledgeFile): boolean {
    return complexExtensions.has(extname(file.path).toLowerCase())
  }

  async parse(file: KnowledgeFile): Promise<ParsedDocument> {
    const result = await this.worker.request<{ title: string; blocks: DocumentBlock[]; pages: number[]; metadata: Record<string, unknown> }>({ action: 'parse', path: file.path })
    return parsedDocument(file.name, result.blocks, result.metadata, result.pages)
  }
}

function parseText(file: KnowledgeFile, text: string, code: boolean): ParsedDocument {
  const blocks: DocumentBlock[] = []
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  let buffer: string[] = []
  let start = 1
  let fence = false
  const flush = (end: number) => {
    if (buffer.some((line) => line.trim())) blocks.push({ kind: code || fence ? 'code' : buffer[0]?.trim().startsWith('|') ? 'table' : 'paragraph', content: buffer.join('\n'), lineStart: start, lineEnd: end, metadata: {} })
    buffer = []
  }
  lines.forEach((line, index) => {
    const markdownHeading = !code && !fence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null
    const symbol = code ? /^\s*(?:(?:export|public|private|static|async|pub)\s+)*(?:class|interface|function|def|fn|func|struct|enum|type)\s+([\w.]+)/.exec(line) : null
    if (markdownHeading || symbol) {
      flush(index)
      blocks.push({ kind: 'heading', content: markdownHeading?.[2] ?? symbol![1], level: markdownHeading?.[1].length ?? 1, lineStart: index + 1, lineEnd: index + 1, metadata: {} })
      start = index + 1
      if (code) buffer.push(line)
    } else if (!code && /^\s*(```|~~~)/.test(line)) {
      if (!fence) { flush(index); start = index + 1 }
      buffer.push(line)
      if (fence) { flush(index + 1); start = index + 2 }
      fence = !fence
    } else if (!line.trim() && !code && !fence) {
      flush(index)
      start = index + 2
    } else {
      if (!buffer.length) start = index + 1
      buffer.push(line)
    }
  })
  flush(lines.length)
  return parsedDocument(file.name, blocks, { parser: code ? 'code' : 'text' })
}
