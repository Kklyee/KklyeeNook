import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test, vi } from 'vitest'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'

import type { AgentMessageProjection } from '@/shared/agent/agentMessage'
import type { AgentMessageRepo } from '../db/repositories/agentMessageRepo'
import { LegacyHistory, type LegacyContinuationHost } from './legacy-history'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('reads the selected legacy JSONL branch as inert read-only records with diagnostics', async () => {
  const root = await tempRoot()
  await writeFile(
    join(root, 'session.jsonl'),
    [
      JSON.stringify({ type: 'session', version: 3, id: 'legacy-a', timestamp: '2026-01-01T00:00:00.000Z', cwd: 'C:/project' }),
      JSON.stringify({ type: 'message', id: 'm1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'root' } }),
      JSON.stringify({ type: 'message', id: 'm2', parentId: 'm1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'abandoned' }] } }),
      JSON.stringify({ type: 'branch_summary', id: 'b1', parentId: 'm1', timestamp: '2026-01-01T00:00:03.000Z', fromId: 'm2', summary: 'left branch' }),
      JSON.stringify({ type: 'message', id: 'm3', parentId: 'b1', timestamp: '2026-01-01T00:00:04.000Z', message: { role: 'toolResult', toolName: 'bash', toolCallId: 'call', content: [{ type: 'text', text: 'output' }], isError: false } }),
      JSON.stringify({ type: 'compaction', id: 'c1', parentId: 'm3', timestamp: '2026-01-01T00:00:05.000Z', summary: 'summary', firstKeptEntryId: 'm1', tokensBefore: 10, details: { files: ['a.ts'] } }),
      '{bad json',
      '',
    ].join('\n'),
  )

  const records = await new LegacyHistory(root).read('legacy-a')

  expect(records.map((record) => record.id)).toEqual(['header:legacy-a', 'm1', 'b1', 'm3', 'c1', expect.stringMatching(/^diagnostic:/)])
  expect(records.every((record) => record.readonly && record.inert && record.agentTaskId === null)).toBe(true)
  expect(records.find((record) => record.id === 'm2')).toBeUndefined()
  expect(records.find((record) => record.id === 'm3')?.role).toBe('tool')
  expect(records.find((record) => record.id === 'c1')?.payload).toMatchObject({ type: 'compaction', details: { files: ['a.ts'] } })
  expect(records.at(-1)).toMatchObject({ kind: 'diagnostic', source: { line: 7 } })
})

test('falls back to immutable Drizzle message projections when no legacy file exists', async () => {
  const root = await tempRoot()
  const repo = new MemoryMessageRepo([
    { id: 'msg-1', sessionId: 'legacy-b', parentId: null, role: 'user', createdAt: 1, payload: { role: 'user', content: 'hello' } },
  ])

  await expect(new LegacyHistory(root, repo).read('legacy-b')).resolves.toMatchObject([
    { id: 'msg-1', role: 'user', readonly: true, inert: true, source: { kind: 'drizzle-message' } },
  ])
})

test('rejects numeric and traversal thread IDs before file access', async () => {
  const root = await tempRoot()
  const history = new LegacyHistory(root)

  await expect(history.read('12345')).rejects.toThrow('Invalid legacy thread ID')
  await expect(history.read('../legacy-a')).rejects.toThrow('Invalid legacy thread ID')
})

test('continues into an independent thread with stable frozen inert projections', async () => {
  const root = await tempRoot()
  const repo = new MemoryMessageRepo()
  await writeFile(
    join(root, 'session.jsonl'),
    [
      JSON.stringify({ type: 'session', version: 3, id: 'legacy-c', timestamp: '2026-01-01T00:00:00.000Z', cwd: 'C:/project' }),
      JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'old request' } }),
    ].join('\n'),
  )
  const host: LegacyContinuationHost = { create: vi.fn(async (input) => ({ id: input.threadId, title: input.title ?? '', workspaceId: input.workspaceId, permissionMode: input.permissionMode, createdAt: 1, updatedAt: 1, archived: false })) }
  const history = new LegacyHistory(root, repo, {
    now: () => 100,
    resolveSourceMetadata: async () => ({ title: 'Legacy', workspaceId: 'workspace-1', permissionMode: 'workspace-write' }),
  })

  const first = await history.continue(host, 'legacy-c', 'new-thread', BACKGROUND_CONTEXT)
  const frozen = await repo.findBySessionId('new-thread')
  await writeFile(
    join(root, 'session.jsonl'),
    [
      JSON.stringify({ type: 'session', version: 3, id: 'legacy-c', timestamp: '2026-01-01T00:00:00.000Z', cwd: 'C:/project' }),
      JSON.stringify({ type: 'message', id: 'u2', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'changed' } }),
    ].join('\n'),
  )
  const second = await history.continue(host, 'legacy-c', 'new-thread', BACKGROUND_CONTEXT)

  expect(first.imported).toBe(true)
  expect(second.imported).toBe(false)
  expect(host.create).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'new-thread', workspaceId: 'workspace-1', permissionMode: 'workspace-write' }), BACKGROUND_CONTEXT)
  expect(await repo.findBySessionId('new-thread')).toEqual(frozen)
  expect(JSON.stringify(frozen)).toContain('No tools or model tasks were replayed')
  expect(JSON.stringify(frozen)).toContain('old request')
  expect(JSON.stringify(frozen)).not.toContain('changed')
})

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'nook-history-test-'))
  roots.push(root)
  return root
}

class MemoryMessageRepo implements AgentMessageRepo {
  private readonly messages = new Map<string, AgentMessageProjection[]>()

  constructor(messages: AgentMessageProjection[] = []) {
    for (const message of messages) this.messages.set(message.sessionId, [...(this.messages.get(message.sessionId) ?? []), message])
  }

  async findBySessionId(sessionId: string): Promise<AgentMessageProjection[]> {
    return [...(this.messages.get(sessionId) ?? [])]
  }

  async save(message: AgentMessageProjection): Promise<void> {
    const messages = (this.messages.get(message.sessionId) ?? []).filter((item) => item.id !== message.id)
    messages.push(message)
    this.messages.set(message.sessionId, messages)
  }

  async replaceBySession(sessionId: string, messages: readonly AgentMessageProjection[]): Promise<void> {
    this.messages.set(sessionId, [...messages])
  }
}
