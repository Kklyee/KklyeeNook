import { expect, test } from 'vitest'

import { getNextScheduledTaskRunAt, validateScheduledTaskSchedule } from './schedule'

test('calculates the next daily run in local time', () => {
  const now = new Date(2026, 8, 28, 8, 30).getTime()
  const next = new Date(getNextScheduledTaskRunAt({ type: 'daily', time: '09:00' }, now)!)

  expect(next.getFullYear()).toBe(2026)
  expect(next.getMonth()).toBe(8)
  expect(next.getDate()).toBe(28)
  expect(next.getHours()).toBe(9)
  expect(next.getMinutes()).toBe(0)
})

test('rolls a daily run to tomorrow after its time has passed', () => {
  const now = new Date(2026, 8, 28, 10, 30).getTime()
  const next = new Date(getNextScheduledTaskRunAt({ type: 'daily', time: '09:00' }, now)!)

  expect(next.getDate()).toBe(29)
  expect(next.getHours()).toBe(9)
})

test('calculates the next weekly run', () => {
  const now = new Date(2026, 8, 28, 10, 30).getTime()
  const next = new Date(
    getNextScheduledTaskRunAt({ type: 'weekly', weekday: 4, time: '09:00' }, now)!,
  )

  expect(next.getDay()).toBe(4)
  expect(next.getDate()).toBe(1)
  expect(next.getMonth()).toBe(9)
})

test('validates only the supported schedule shapes', () => {
  expect(() => validateScheduledTaskSchedule({ type: 'once', runAt: Number.NaN })).toThrow()
  expect(() => validateScheduledTaskSchedule({ type: 'daily', time: '24:00' })).toThrow()
  expect(() => validateScheduledTaskSchedule({ type: 'weekly', weekday: 7, time: '09:00' })).toThrow()
})
