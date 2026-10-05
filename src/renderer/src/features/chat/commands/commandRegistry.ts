import type { AgentSkill } from '@/shared/agent/agentSkill'

export type CommandKind = 'system' | 'skill'

export interface CommandDefinition {
  id: string
  kind: CommandKind
  label: string
  description: string
  usage?: string
  disabled?: boolean
  disabledReason?: string
}

export const builtinCommands: CommandDefinition[] = [
  {
    id: 'compact',
    kind: 'system',
    label: '/compact',
    description: '手动整理当前上下文',
    usage: '/compact [instructions]',
  },
  {
    id: 'reload',
    kind: 'system',
    label: '/reload',
    description: '重新加载 Skills 和 Agent resources',
  },
  { id: 'new', kind: 'system', label: '/new', description: '创建新会话' },
  {
    id: 'rename',
    kind: 'system',
    label: '/rename',
    description: '重命名当前会话',
    usage: '/rename <title>',
  },
  { id: 'session', kind: 'system', label: '/session', description: '查看当前 Session' },
]

export function toSkillCommand(skill: AgentSkill): CommandDefinition {
  return {
    id: skill.id,
    kind: 'skill',
    label: `/${skill.id}`,
    description: skill.description ?? skill.name,
  }
}

export function getCommands(skills: AgentSkill[], busy: boolean): CommandDefinition[] {
  return [
    ...builtinCommands.map((command) => ({
      ...command,
      disabled: busy && ['compact', 'reload', 'new'].includes(command.id),
      disabledReason:
        busy && ['compact', 'reload', 'new'].includes(command.id) ? '运行中不可用' : undefined,
    })),
    ...skills
      .filter((skill) => !builtinCommands.some((command) => command.id === skill.id))
      .map(toSkillCommand),
  ]
}
