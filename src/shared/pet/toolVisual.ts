import type { PetAction } from './petState'

export const TOOL_VISUALS: Record<string, PetAction> = {
  read: 'reading',

  write: 'typing',
  edit: 'typing',

  bash: 'terminal',

  grep: 'searching',
  find: 'searching',
}

export function getToolAction(tool: string): PetAction {
  return TOOL_VISUALS[tool] ?? 'none'
}
