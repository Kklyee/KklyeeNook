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
  const searches = completed.filter(
    (activity) => activity.type === 'search' || activity.type === 'glob',
  ).length
  const reads = files('read')
  const labels = [
    writes ? `创建了 ${writes} 个文件` : '',
    edits ? `编辑了 ${edits} 个文件` : '',
    shells ? `运行了 ${shells} 个命令` : '',
    searches ? `搜索了 ${searches} 次` : '',
    reads ? `读取了 ${reads} 个文件` : '',
  ].filter(Boolean)
  return labels.join(' · ') || '本轮活动已完成'
}
