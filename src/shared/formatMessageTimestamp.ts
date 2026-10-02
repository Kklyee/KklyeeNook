const pad = (value: number): string => String(value).padStart(2, '0')

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

export function formatMessageTimestamp(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''

  const current = new Date(now)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (isSameLocalDay(date, current)) return time

  const day = `${date.getMonth() + 1}月${date.getDate()}日`
  if (date.getFullYear() === current.getFullYear()) return `${day} ${time}`

  return `${date.getFullYear()}年${day} ${time}`
}

export function formatMessageTimestampFull(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''

  return (
    `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}
