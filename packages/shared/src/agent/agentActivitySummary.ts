import type { AgentActivity } from '@kklyeenook/shared/agent/agentActivity'

export interface AgentActivitySummaryGroup {
  type: AgentActivity['type']
  label: string
}

export function summarizeAgentActivityGroups(
  activities: readonly AgentActivity[],
): AgentActivitySummaryGroup[] {
  const completed = activities.filter((activity) => activity.status === 'completed')
  const files = (type: 'read' | 'edit' | 'write') =>
    new Set(
      completed
        .filter((activity) => activity.type === type)
        .map((activity) => ('path' in activity ? (activity.path ?? activity.id) : activity.id)),
    ).size
  const writes = files('write')
  const edits = files('edit')
  const shells = completed.filter((activity) => activity.type === 'shell').length
  const webSearches = completed.filter((activity) => activity.type === 'web_search').length
  const searches = completed.filter(
    (activity) => activity.type === 'search' || activity.type === 'glob',
  ).length
  const reads = files('read')
  const groups: AgentActivitySummaryGroup[] = []
  if (writes) groups.push({ type: 'write', label: `创建了 ${writes} 个文件` })
  if (edits) groups.push({ type: 'edit', label: `编辑了 ${edits} 个文件` })
  if (shells) groups.push({ type: 'shell', label: `运行了 ${shells} 个命令` })
  if (webSearches) groups.push({ type: 'web_search', label: `搜索了 ${webSearches} 次网页` })
  if (searches) groups.push({ type: 'search', label: `搜索了 ${searches} 次` })
  if (reads) groups.push({ type: 'read', label: `读取了 ${reads} 个文件` })
  return groups
}

export function summarizeAgentActivities(activities: readonly AgentActivity[]): string {
  const labels = summarizeAgentActivityGroups(activities)
    .slice(0, 2)
    .map((group) => group.label)
  return labels.join(' · ') || '本轮活动已完成'
}
