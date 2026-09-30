import { extname } from 'node:path'
import { OfficeParser, type OfficeContentNode, type OfficeParserAST } from 'officeparser'
import type { DocumentBlock, KnowledgeFile, ParsedDocument } from '@/shared/knowledge/knowledge'
import { parsedDocument, type DocumentParser } from './documentParser'

export class OfficeParserAdapter implements DocumentParser {
  private readonly controller = new AbortController()

  supports(file: KnowledgeFile): boolean { return ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm'].includes(extname(file.path).toLowerCase()) }

  async parse(file: KnowledgeFile): Promise<ParsedDocument> {
    const ast = await OfficeParser.parseOffice(file.path, {
      extractAttachments: true,
      ocr: true,
      ocrConfig: { language: 'eng+chi_sim', preserveLayout: true },
      ignoreHeadersAndFooters: true,
      ignoreSlideMasters: true,
      abortSignal: this.controller.signal,
      pdfParserConfig: { separateProcess: false },
    })
    const ocrFailures = ast.warnings.filter((warning) => warning.code === 'OCR_FAILED')
    if (ocrFailures.length) throw new Error(ocrFailures.map((warning) => warning.message).join('\n'))
    return normalizeOfficeAst(ast, file.name)
  }

  async close(): Promise<void> {
    this.controller.abort()
    await OfficeParser.terminateOcr()
  }
}

export function normalizeOfficeAst(ast: Pick<OfficeParserAST, 'content' | 'metadata' | 'attachments' | 'warnings'>, name: string): ParsedDocument {
  const blocks: DocumentBlock[] = []
  const pages = new Set<number>()
  const walk = (nodes: OfficeContentNode[], page?: number, sheet?: string) => {
    for (const node of nodes) {
      const metadata: Record<string, unknown> = { ...node.metadata, ...(node.bounds ? { bounds: node.bounds } : {}), ...(sheet ? { sheet } : {}) }
      if (node.type === 'page' || node.type === 'slide') {
        const nodePage = node.type === 'page' ? node.metadata?.pageNumber : node.metadata?.slideNumber
        if (nodePage) pages.add(nodePage)
        if (node.type === 'slide') blocks.push({ kind: 'heading', content: `Slide ${nodePage}`, level: 1, page: nodePage, metadata })
        walk(node.children ?? [], nodePage, sheet)
        continue
      }
      if (node.type === 'sheet') {
        const sheetName = node.metadata?.sheetName ?? node.text ?? 'Sheet'
        blocks.push({ kind: 'heading', content: sheetName, level: 1, metadata: { sheet: sheetName } })
        const rows = node.children?.filter((child) => child.type === 'row') ?? []
        if (rows.length) blocks.push(tableBlock({ type: 'table', children: rows }, undefined, { sheet: sheetName }))
        walk((node.children ?? []).filter((child) => child.type !== 'row'), page, sheetName)
        continue
      }
      if (node.type === 'table') {
        if (node.children?.length) blocks.push(tableBlock(node, page, metadata))
      } else if (node.type === 'image') {
        const attachment = ast.attachments.find((attachment) => attachment.name === node.metadata?.attachmentName)
        const content = node.text || attachment?.ocrText || node.metadata?.altText
        if (content?.trim()) blocks.push({ kind: 'image', content, ...(page ? { page } : {}), metadata: { ...metadata, ocr: Boolean(attachment?.ocrText) } })
      } else if (['heading', 'paragraph', 'list', 'code', 'text', 'note'].includes(node.type)) {
        const content = node.type === 'list' ? listText(node) : nodeText(node)
        if (content.trim()) blocks.push({ kind: node.type === 'heading' ? 'heading' : node.type === 'code' ? 'code' : node.type === 'list' ? 'list' : 'paragraph', content, ...(node.type === 'heading' ? { level: node.metadata?.level ?? 1 } : {}), ...(page ? { page } : {}), metadata })
      } else if (!['header', 'footer', 'slideMaster', 'break', 'comment'].includes(node.type)) walk(node.children ?? [], page, sheet)
      if (node.notes?.length) walk(node.notes, page, sheet)
    }
  }
  walk(ast.content)
  return parsedDocument(name, blocks, { parser: 'officeparser', ...ast.metadata, warnings: ast.warnings.map((warning) => ({ code: warning.code, message: warning.message })) }, [...pages])
}

function nodeText(node: OfficeContentNode): string {
  return node.text ?? (node.children ?? []).map(nodeText).join(node.type === 'paragraph' || node.type === 'heading' ? '' : '\n')
}

function listText(node: OfficeContentNode): string {
  return node.children?.length ? node.children.map((child, index) => `${node.metadata && 'ordered' in node.metadata && node.metadata.ordered ? `${index + 1}.` : '-'} ${nodeText(child)}`).join('\n') : node.text ?? ''
}

function tableBlock(node: OfficeContentNode, page: number | undefined, metadata: Record<string, unknown>): DocumentBlock {
  const rows = (node.children ?? []).filter((row) => row.type === 'row')
  const cells = rows.map((row) => (row.children ?? []).filter((cell) => cell.type === 'cell'))
  const grid = cells.map((row) => row.flatMap((cell) => [nodeText(cell), ...Array(Math.max(0, (cell.metadata?.colSpan ?? 1) - 1)).fill('')]))
  const width = Math.max(1, ...grid.map((row) => row.length))
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => (row[index] ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')).join(' | ')} |`
  const content = [line(grid[0] ?? []), line(Array(width).fill('---')), ...grid.slice(1).map(line)].join('\n')
  const rowNumbers = cells.flat().map((cell) => cell.metadata?.row).filter((value): value is number => value !== undefined)
  return { kind: 'table', content, ...(page ? { page } : {}), metadata: { ...metadata, cells: cells.map((row) => row.map((cell) => ({ ...cell.metadata, content: nodeText(cell), bounds: cell.bounds }))), ...(rowNumbers.length ? { rowStart: Math.min(...rowNumbers), rowEnd: Math.max(...rowNumbers) } : {}) } }
}
