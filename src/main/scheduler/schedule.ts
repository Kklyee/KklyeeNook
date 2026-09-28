import type { ScheduledTaskSchedule } from '@/shared/scheduler/scheduledTask'

export function getNextScheduledTaskRunAt(
  schedule: ScheduledTaskSchedule,
  now = Date.now(),
): number | undefined {
  validateScheduledTaskSchedule(schedule)

  if (schedule.type === 'once') return schedule.runAt

  const current = new Date(now)
  const [hours, minutes] = schedule.time.split(':').map(Number)
  const candidate = new Date(current)
  candidate.setHours(hours, minutes, 0, 0)

  if (schedule.type === 'daily') {
    if (candidate.getTime() <= now) candidate.setDate(candidate.getDate() + 1)
    return candidate.getTime()
  }

  const daysUntil = (schedule.weekday - current.getDay() + 7) % 7
  candidate.setDate(candidate.getDate() + daysUntil)
  if (candidate.getTime() <= now) candidate.setDate(candidate.getDate() + 7)
  return candidate.getTime()
}

export function validateScheduledTaskSchedule(schedule: ScheduledTaskSchedule): void {
  if (schedule.type === 'once') {
    if (!Number.isFinite(schedule.runAt)) throw new Error('Scheduled task runAt must be a number')
    return
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) {
    throw new Error('Scheduled task time must use HH:mm')
  }

  if (schedule.type === 'weekly' && (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6)) {
    throw new Error('Scheduled task weekday must be between 0 and 6')
  }
}
