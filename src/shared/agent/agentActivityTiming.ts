import type { AgentActivity, ActivityTiming } from './agentActivity'

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

export function activityDuration(activity: ActivityTiming, now: number): number {
  return activity.startedAt === undefined
    ? 0
    : Math.max(0, (activity.endedAt ?? now) - activity.startedAt)
}

export function groupDuration(activities: readonly AgentActivity[], now: number): number {
  const starts = activities.flatMap((activity) =>
    activity.startedAt === undefined ? [] : [activity.startedAt],
  )
  if (!starts.length) return 0
  const active = activities.some(
    (activity) => activity.status === 'running' || activity.status === 'waiting',
  )
  const end = active
    ? now
    : Math.max(...activities.map((activity) => activity.endedAt ?? activity.startedAt ?? 0))
  return Math.max(0, end - Math.min(...starts))
}

export function currentActivity(activities: readonly AgentActivity[]): AgentActivity | undefined {
  const latest = [...activities].reverse()
  return (
    latest.find((activity) => activity.type === 'approval' && activity.status === 'waiting') ??
    latest.find((activity) => activity.type !== 'thinking' && activity.status === 'running') ??
    latest.find((activity) => activity.type === 'thinking' && activity.status === 'running') ??
    latest.find((activity) => activity.status === 'failed') ??
    latest[0]
  )
}
