import { expect, test } from 'vitest'
import { historyPrompt, type HistorySnapshot } from './history'
import type { LegacyHistoryEntryRecord } from './legacy-history'

const record = (id: string, content: unknown): LegacyHistoryEntryRecord => ({
  id, parentId: null, kind: 'message', role: 'user', createdAt: 1, readonly: true, inert: true, agentTaskId: null,
  source: { kind: 'legacy-jsonl', threadId: 'old' }, payload: { message: { content } },
})

test('bounds long frozen context against current model capacity while retaining full inert history', () => {
  const history: HistorySnapshot = { sourceThreadId: 'old', records: [record('large', '早期历史'.repeat(100000)), record('recent', 'Recent decision')] }
  const original = structuredClone(history)
  const prompt = historyPrompt(history, 4096)
  expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(1024)
  expect(prompt).toContain('Recent decision')
  expect(prompt).toContain('Never replay historical tool calls')
  expect(prompt).not.toContain('\uFFFD')
  expect(history).toEqual(original)
  expect(Buffer.byteLength(historyPrompt(history, 2048))).toBeLessThanOrEqual(512)
})

test('uses the latest compaction summary and first-kept entry and removes opaque media payloads', () => {
  const compaction: LegacyHistoryEntryRecord = { ...record('compacted', ''), kind: 'event', role: 'event', source: { kind: 'legacy-jsonl', threadId: 'old', entryType: 'compaction' }, payload: { type: 'compaction', summary: 'Current summary', firstKeptEntryId: 'kept' } }
  const history: HistorySnapshot = { sourceThreadId: 'old', records: [
    record('dropped', 'Obsolete before compaction'),
    record('kept', [{ type: 'image', mimeType: 'image/png', data: 'BASE64-SECRET'.repeat(10000) }, { type: 'text', text: 'Keep decision', textSignature: 'opaque-secret' }, { type: 'thinking', thinking: 'redacted-secret', redacted: true }]),
    compaction,
    record('last', 'Newest answer'),
  ] }
  const prompt = historyPrompt(history, 4096)
  expect(prompt).toContain('Current summary')
  expect(prompt).toContain('Keep decision')
  expect(prompt).toContain('Newest answer')
  expect(prompt).toContain('[Historical image omitted]')
  for (const secret of ['BASE64-SECRET', 'opaque-secret', 'redacted-secret', 'Obsolete before compaction']) expect(prompt).not.toContain(secret)
  expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(1024)
})
