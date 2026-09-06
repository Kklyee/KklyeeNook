export type BuiltinToolName = 'read' | 'write' | 'edit' | 'bash' | 'grep' | 'find' | 'ls'

const BUILTIN_TOOLS = new Set<BuiltinToolName>([
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'find',
  'ls',
])

export function resolveBuiltinTools(enabled: string[]): BuiltinToolName[] {
  return enabled.filter((name): name is BuiltinToolName =>
    BUILTIN_TOOLS.has(name as BuiltinToolName),
  )
}
