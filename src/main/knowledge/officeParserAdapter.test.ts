import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { normalizeOfficeAst, OfficeParserAdapter } from './officeParserAdapter'

test.each(['architecture.pdf', 'requirements.docx'])('parses the real %s fixture', async (name) => {
  const parser = new OfficeParserAdapter()
  try {
    const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
    const result = await parser.parse({ path, name })
    expect(result.blocks.map((block) => block.content).join('\n')).toContain('process')
    if (name.endsWith('.pdf')) {
      expect(result.pages).toEqual([1])
      expect(result.blocks.every((block) => block.page === 1)).toBe(true)
    } else {
      expect(result.sections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'Agent process isolation requirements', level: 1 }),
        ]),
      )
    }
  } finally {
    await parser.close()
  }
})

test('normalizes AST reading order, merged cells, lists and image OCR with page geometry', () => {
  const document = normalizeOfficeAst(
    {
      metadata: { author: 'KK', pages: 2 },
      warnings: [],
      attachments: [
        {
          type: 'image',
          name: 'scan.png',
          ocrText: 'Scanned reason for process isolation',
          mimeType: 'image/png',
          extension: 'png',
          data: '',
        },
      ],
      content: [
        {
          type: 'page',
          metadata: { pageNumber: 2 },
          children: [
            {
              type: 'heading',
              text: 'Process Isolation',
              metadata: { level: 2 },
              bounds: { x: 10, y: 20, width: 200, height: 40 },
            },
            {
              type: 'paragraph',
              text: 'Protect the UI',
              children: [{ type: 'text', text: 'Protect the UI' }],
            },
            {
              type: 'table',
              children: [
                {
                  type: 'row',
                  children: [
                    { type: 'cell', text: 'Agent', metadata: { row: 1, col: 1, colSpan: 2 } },
                  ],
                },
                {
                  type: 'row',
                  children: [
                    { type: 'cell', text: 'Process', metadata: { row: 2, col: 1 } },
                    { type: 'cell', text: 'Independent', metadata: { row: 2, col: 2 } },
                  ],
                },
              ],
            },
            {
              type: 'list',
              children: [
                { type: 'paragraph', text: 'Reliability' },
                { type: 'paragraph', text: 'Responsiveness' },
              ],
            },
            { type: 'image', metadata: { attachmentName: 'scan.png' } },
          ],
        },
      ],
    },
    'architecture.pdf',
  )
  expect(document.blocks.map((block) => block.kind)).toEqual([
    'heading',
    'paragraph',
    'table',
    'list',
    'image',
  ])
  expect(document.blocks[0]).toMatchObject({ page: 2, level: 2, metadata: { bounds: { x: 10 } } })
  expect(document.tables[0]).toMatchObject({
    content: '| Agent |  |\n| --- | --- |\n| Process | Independent |',
    metadata: { cells: [[expect.objectContaining({ colSpan: 2 })], expect.any(Array)] },
  })
  expect(document.blocks[4]).toMatchObject({
    content: 'Scanned reason for process isolation',
    page: 2,
    metadata: { ocr: true },
  })
  expect(document.paragraphs.filter((block) => block.content === 'Protect the UI')).toHaveLength(1)
})

test('parses a real HTML document with headings and tables through officeparser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'office-adapter-'))
  const parser = new OfficeParserAdapter()
  try {
    const path = join(directory, 'architecture.html')
    await writeFile(
      path,
      '<html><head><title>Architecture</title></head><body><h1>Agent Backend</h1><p>A separate process protects the UI.</p><table><tr><th>Component</th><th>Reason</th></tr><tr><td>Agent</td><td>Isolation</td></tr></table></body></html>',
    )
    const result = await parser.parse({ path, name: 'architecture.html' })
    expect(result.sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Agent Backend', level: 1 })]),
    )
    expect(result.tables[0].content).toContain('Isolation')
    expect(result.paragraphs[0].content).toContain('separate process')
    for (const name of ['a.pdf', 'a.docx', 'a.pptx', 'a.xlsx'])
      expect(parser.supports({ path: name, name })).toBe(true)
  } finally {
    await parser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
