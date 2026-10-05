import type { ParsedCommand } from './commandParser'

export type CommandResult = { title: string; message?: string; rows?: Array<[string, string]> }

export interface CommandActions {
  compact(instructions: string): Promise<void>
  reload(): Promise<void>
  newConversation(): Promise<void>
  rename(title: string): Promise<void>
  session(): Promise<CommandResult>
}

export async function executeCommand(
  command: ParsedCommand,
  actions: CommandActions,
): Promise<CommandResult | undefined> {
  switch (command.definition.id) {
    case 'compact':
      await actions.compact(command.arguments)
      return { title: 'Compact', message: '上下文已整理' }
    case 'reload':
      await actions.reload()
      return { title: 'Reload', message: 'Skills 和 Agent resources 已重新加载' }
    case 'new':
      await actions.newConversation()
      return undefined
    case 'rename':
      if (!command.arguments) return { title: 'Rename', message: '用法：/rename <title>' }
      await actions.rename(command.arguments)
      return { title: 'Rename', message: '会话标题已更新' }
    case 'session':
      return actions.session()
  }
  return undefined
}
