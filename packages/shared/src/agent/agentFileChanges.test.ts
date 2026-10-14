import { describe, expect, test } from 'vitest'
import { collectAgentFileChanges } from '@kklyeenook/shared/agent/agentFileChanges'

const success = { status: 'success' as const, content: [] }

describe('collectAgentFileChanges', () => {
  test('summarizes edits and writes as unique files with line stats', () => {
    const changes = collectAgentFileChanges([
      {
        toolName: 'edit',
        args: { path: 'src/app.ts', oldText: 'old\n', newText: 'new\nextra\n' },
        result: success,
      },
      {
        toolName: 'edit',
        args: { path: 'src/app.ts', oldText: 'more\n', newText: 'changed\n' },
        result: success,
      },
      {
        toolName: 'write',
        args: { path: 'src/added.ts', content: 'const value = 1\n' },
        result: { status: 'success', content: [], details: { created: true } },
      },
      { toolName: 'read', args: { path: 'src/app.ts' }, result: success },
    ])

    expect(changes.map((change) => change.path)).toEqual(['src/app.ts', 'src/added.ts'])
    expect(changes[0]).toMatchObject({ operation: 'modified', additions: 3, deletions: 2 })
    expect(changes[0]!.diff).toContain('src/app.ts')
    expect(changes[1]).toMatchObject({ operation: 'created', additions: 1, deletions: 0 })
  })

  test('ignores failed, rejected and unsuccessful changes', () => {
    expect(
      collectAgentFileChanges([
        { toolName: 'write', args: { path: 'a.ts' }, result: success, isError: true },
        { toolName: 'write', args: { path: 'b.ts' }, result: success, approvalRejected: true },
        {
          toolName: 'write',
          args: { path: 'c.ts' },
          result: { status: 'error', content: [], error: { code: 'X', message: 'nope' } },
        },
        { toolName: 'write', args: {}, result: success },
      ]),
    ).toEqual([])
  })

  test('keeps the created operation when a path is later edited', () => {
    const changes = collectAgentFileChanges([
      {
        toolName: 'write',
        args: { path: 'new.ts', content: 'a\n' },
        result: { status: 'success', content: [], details: { created: true } },
      },
      {
        toolName: 'edit',
        args: { path: 'new.ts', oldText: 'a\n', newText: 'b\n' },
        result: success,
      },
    ])
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ operation: 'created', additions: 2, deletions: 1 })
  })

  test('prefers a provider patch over reconstructed diff text', () => {
    const changes = collectAgentFileChanges([
      {
        toolName: 'edit',
        args: { path: 'a.ts', oldText: 'x\n', newText: 'y\n' },
        result: {
          status: 'success',
          content: [],
          details: { patch: '--- a.ts\n+++ a.ts\n@@ -1 +1,2 @@\n-x\n+y\n+z\n' },
        },
      },
    ])
    expect(changes[0]).toMatchObject({ additions: 2, deletions: 1 })
  })

  test('falls back to reconstructed stats when the provider patch is unparsable', () => {
    const changes = collectAgentFileChanges([
      {
        toolName: 'edit',
        args: { path: 'a.ts', oldText: 'x\n', newText: 'y\n' },
        result: { status: 'success', content: [], details: { patch: 'not a patch' } },
      },
    ])
    expect(changes[0]).toMatchObject({ additions: 1, deletions: 1 })
  })
})
