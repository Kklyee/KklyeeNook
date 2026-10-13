import { expect, test } from 'vitest'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { emptySnapshot } from './projection'
import { sliceRunHistory } from './thread-history'

const snapshot = { ...emptySnapshot(), entries: Array.from({ length: 20 }, (_, index) => ({ id: index + 1 } as EntryRecord)) }

test('loads two whole runs at a time including steer entries with no overlap', () => {
  const starts = [1, 5, 9, 13, 17, 17]
  const latest = sliceRunHistory(snapshot, starts)
  expect(latest.entries.map((entry) => entry.id)).toEqual([13, 14, 15, 16, 17, 18, 19, 20])
  expect(latest.hasMore).toBe(true)
  const older = sliceRunHistory(snapshot, starts, latest.sinceEntry)
  expect(older.entries.map((entry) => entry.id)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  const first = sliceRunHistory(snapshot, starts, older.sinceEntry)
  expect(first.entries.map((entry) => entry.id)).toEqual([1, 2, 3, 4])
  expect(first.hasMore).toBe(false)
  expect(sliceRunHistory(snapshot, starts, first.sinceEntry).entries).toEqual([])
})

test('empty and not-yet-started threads do not lose their entries', () => {
  expect(sliceRunHistory(emptySnapshot(), []).entries).toEqual([])
  expect(sliceRunHistory(snapshot, []).entries).toEqual(snapshot.entries)
  expect(sliceRunHistory(snapshot, [1]).hasMore).toBe(false)
})
