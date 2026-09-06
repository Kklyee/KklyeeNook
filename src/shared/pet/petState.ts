export type PetAction = 'none' | 'reading' | 'typing' | 'terminal' | 'searching'

export interface PetState {
  activity: 'idle' | 'thinking' | 'working' | 'waiting' | 'success' | 'error'

  action?: PetAction

  currentTool?: string
  message?: string
}
