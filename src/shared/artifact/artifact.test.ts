import { describe, expect, test } from 'vitest'

import { artifactFilename, artifactText, parseArtifactDraft } from './artifact'

describe('artifact domain', () => {
  test('parses every supported artifact kind', () => {
    expect(parseArtifactDraft({ kind: 'code', title: 'Code', content: 'let x = 1' })?.kind).toBe(
      'code',
    )
    expect(parseArtifactDraft({ kind: 'diff', title: 'Diff', patch: '@@ -1 +1 @@' })?.kind).toBe(
      'diff',
    )
    expect(
      parseArtifactDraft({ kind: 'table', title: 'Table', columns: ['A'], rows: [[1]] })?.kind,
    ).toBe('table')
    expect(parseArtifactDraft({ kind: 'markdown', title: 'Doc', content: '# Doc' })?.kind).toBe(
      'markdown',
    )
    expect(
      parseArtifactDraft({ kind: 'file', title: 'File', filename: 'a.txt', content: 'a' })?.kind,
    ).toBe('file')
  })

  test('rejects malformed tables and serializes valid tables as CSV', () => {
    expect(
      parseArtifactDraft({ kind: 'table', title: 'Bad', columns: ['A'], rows: [{}] }),
    ).toBeUndefined()
    const table = {
      kind: 'table' as const,
      title: 'Report',
      columns: ['Name', 'Note'],
      rows: [['A', 'x,y']],
    }
    expect(artifactText(table)).toBe('Name,Note\nA,"x,y"')
    expect(artifactFilename(table)).toBe('Report.csv')
  })
})
