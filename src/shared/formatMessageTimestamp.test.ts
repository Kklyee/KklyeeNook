import { expect, test } from 'vitest'

import { formatMessageTimestamp, formatMessageTimestampFull } from './formatMessageTimestamp'

const at = (year: number, month: number, day: number, hour: number, minute: number, second = 0) =>
  new Date(year, month - 1, day, hour, minute, second).getTime()

test('formats a message from the same local day as time only', () => {
  expect(formatMessageTimestamp(at(2026, 10, 2, 23, 41), at(2026, 10, 2, 23, 59))).toBe('23:41')
  expect(formatMessageTimestamp(at(2026, 10, 2, 0, 4), at(2026, 10, 2, 16, 13))).toBe('00:04')
})

test('keeps the date when the message is from the previous local day', () => {
  expect(formatMessageTimestamp(at(2025, 12, 31, 23, 50), at(2026, 1, 1, 0, 10))).toBe(
    '2025年12月31日 23:50',
  )
  expect(formatMessageTimestamp(at(2026, 10, 1, 23, 41), at(2026, 10, 2, 0, 10))).toBe(
    '10月1日 23:41',
  )
})

test('formats earlier dates in the same local year as month, day and time', () => {
  expect(formatMessageTimestamp(at(2026, 10, 2, 23, 41), at(2026, 10, 5, 9, 0))).toBe(
    '10月2日 23:41',
  )
  expect(formatMessageTimestamp(at(2026, 9, 30, 16, 13), at(2026, 10, 5, 9, 0))).toBe(
    '9月30日 16:13',
  )
})

test('formats dates from other years with the full date', () => {
  expect(formatMessageTimestamp(at(2025, 12, 28, 21, 16), at(2026, 10, 5, 9, 0))).toBe(
    '2025年12月28日 21:16',
  )
})

test('pads single digit hours and minutes', () => {
  expect(formatMessageTimestamp(at(2026, 10, 2, 9, 5), at(2026, 10, 2, 10, 0))).toBe('09:05')
})

test('formats the full timestamp for the hover title', () => {
  expect(formatMessageTimestampFull(at(2026, 10, 2, 23, 41, 26))).toBe('2026年10月2日 23:41:26')
})

test('returns an empty string for an invalid timestamp', () => {
  expect(formatMessageTimestamp(Number.NaN)).toBe('')
  expect(formatMessageTimestampFull(Number.NaN)).toBe('')
})
