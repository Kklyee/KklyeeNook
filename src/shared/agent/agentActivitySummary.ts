import type { AgentActivity } from './agentActivity'

export function summarizeAgentActivities(activities: readonly AgentActivity[]): string {
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
  const labels = [
    writes ? `创建了 ${writes} 个文件` : '',
    edits ? `编辑了 ${edits} 个文件` : '',
    shells ? `运行了 ${shells} 个命令` : '',
    webSearches ? `搜索了 ${webSearches} 次网页` : '',
    searches ? `搜索了 ${searches} 次` : '',
    reads ? `读取了 ${reads} 个文件` : '',
  ].filter(Boolean)
  return labels.slice(0, 2).join(' · ') || '本轮活动已完成'
}
