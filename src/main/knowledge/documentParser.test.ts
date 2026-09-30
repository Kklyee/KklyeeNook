import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { CodeParser, TextParser, supportsKnowledgeFile, parsedDocument } from './documentParser'
import { chunkDocument, estimateTokens } from './chunkDocument'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function file(name: string, content: string) {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-parser-'))
  directories.push(directory)
  const path = join(directory, name)
  await writeFile(path, content)
  return { path, name }
}

test('preserves markdown heading hierarchy, fenced code and tables without inventing headings', async () => {
  const input = await file('architecture.md', '# Architecture\n\nIntro\n\n## Isolation\n\nSeparate processes\n\n| Name | Reason |\n| --- | --- |\n| Agent | Isolation |\n\n```md\n# not a heading\n```')
  const document = await new TextParser().parse(input)
  expect(document.sections.map((section) => section.title)).toEqual(['Architecture', 'Isolation'])
  expect(document.tables[0]).toMatchObject({ lineStart: 9, lineEnd: 11 })
  expect(document.paragraphs.at(-1)).toMatchObject({ kind: 'code', content: '```md\n# not a heading\n```' })
  const chunks = chunkDocument(document, { documentId: 'doc', sourceId: 'source', sourceName: 'Docs', filePath: input.path, title: input.name })
  expect(chunks.find((chunk) => chunk.parentId && chunk.content.includes('Separate processes'))).toMatchObject({ citation: { heading: 'Architecture / Isolation', lineStart: 5 }, contextualContent: expect.stringContaining('Document: architecture.md') })
})

test('preserves code symbols, source lines and full content across bounded parent and child chunks', async () => {
  const content = `export class AgentService {\n${Array.from({ length: 500 }, (_, index) => `  const worker${index} = "process isolation";`).join('\n')}\n}`
  const input = await file('agentService.ts', content)
  const document = await new CodeParser().parse(input)
  const chunks = chunkDocument(document, { documentId: 'doc', sourceId: 'source', sourceName: 'Workspace', filePath: input.path, title: input.name })
  const children = chunks.filter((chunk) => chunk.parentId)
  expect(children.length).toBeGreaterThan(10)
  expect(children.every((chunk) => estimateTokens(chunk.content) <= 450)).toBe(true)
  expect(chunks.filter((chunk) => !chunk.parentId).every((chunk) => estimateTokens(chunk.content) <= 1800)).toBe(true)
  expect(children.map((chunk) => chunk.content).join('\n')).toContain('worker499')
  expect(children.at(-1)!.citation.lineEnd).toBe(502)
  expect(children.every((chunk) => chunks.some((parent) => parent.id === chunk.parentId))).toBe(true)
})

test('retains reading order, layout provenance, table content and page citations', () => {
  const document = parsedDocument('report.pdf', [
    { kind: 'heading', level: 1, content: 'Process isolation', page: 1, metadata: {} },
    { kind: 'paragraph', content: 'OCR text from scanned PDF', page: 1, metadata: { provenance: [{ bbox: { l: 10, t: 100 } }] } },
    { kind: 'table', content: '| Agent | Process |\n| --- | --- |\n| Main | Separate |', page: 2, metadata: {} },
  ], { parser: 'officeparser' }, [1, 2])
  expect(document.pages).toEqual([1, 2])
  expect(document.tables[0].content).toContain('Separate')
  const chunks = chunkDocument(document, { documentId: 'doc', sourceId: 'source', sourceName: 'Docs', filePath: 'report.pdf', title: 'report.pdf' })
  expect(chunks[0].citation).toMatchObject({ page: 1, pageEnd: 2, heading: 'Process isolation' })
  expect(chunks[0].metadata.spans).toEqual(expect.arrayContaining([expect.objectContaining({ metadata: { provenance: [{ bbox: { l: 10, t: 100 } }] } })]))
})

test('bounds huge single lines and CJK blocks without dropping characters', async () => {
  const input = await file('long.txt', '中文知识检索'.repeat(1000))
  const document = await new TextParser().parse(input)
  const children = chunkDocument(document, { documentId: 'doc', sourceId: 'source', sourceName: 'Docs', filePath: input.path, title: input.name }).filter((chunk) => chunk.parentId)
  expect(children.every((chunk) => estimateTokens(chunk.content) <= 450)).toBe(true)
  expect(children.map((chunk) => chunk.content).join('')).toBe('中文知识检索'.repeat(1000))
  expect(supportsKnowledgeFile('a.exe')).toBe(false)
  expect(supportsKnowledgeFile('a.PDF')).toBe(true)
  expect(supportsKnowledgeFile('main.rs')).toBe(true)
})
