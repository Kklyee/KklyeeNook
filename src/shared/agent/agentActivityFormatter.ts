import type { AgentActivity, ActivityStatus } from './agentActivity'

export function getThinkingPreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function formatActivityLabel(
  activity: AgentActivity,
  mode: ActivityStatus = activity.status,
): string {
  if (activity.type === 'thinking') {
    const label = mode === 'running' ? '思考中' : mode === 'failed' ? '思考中断' : '思考'
    const preview = getThinkingPreview(activity.content)
    return preview ? `${label} · ${preview}` : label
  }
  if (activity.type === 'approval') {
    return mode === 'waiting' ? '等待你的确认…' : mode === 'failed' ? '确认未通过' : '已确认'
  }
  const verbs = {
    read: '读取',
    search: '搜索',
    glob: '查找',
    edit: '编辑',
    write: '创建',
    shell: '运行',
    tool: '调用',
  }
  const target =
    'path' in activity
      ? activity.path?.replaceAll('\\', '/').split('/').at(-1)
      : activity.type === 'search'
        ? activity.query
        : activity.type === 'glob'
          ? activity.pattern
          : activity.type === 'shell'
            ? activity.command
            : activity.type === 'tool'
              ? activity.toolName
              : undefined
  const verb = verbs[activity.type]
  const label = mode === 'running' ? `正在${verb}` : mode === 'failed' ? `${verb}失败` : `已${verb}`
  return `${label}${target ? ` ${target}` : ''}${mode === 'running' ? '…' : ''}`
}
