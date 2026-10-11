import { builtinCommands, type CommandDefinition } from './commandRegistry'

export interface ParsedCommand {
  definition: CommandDefinition
  arguments: string
}

export function parseSystemCommand(text: string): ParsedCommand | undefined {
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text)
  if (!match) return undefined
  const definition = builtinCommands.find((command) => command.id === match[1])
  return definition ? { definition, arguments: match[2]?.trim() ?? '' } : undefined
}
