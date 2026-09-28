export const SUBAGENT_AVATARS = ['🦊', '🐼', '🐸', '🐨', '🐰', '🦉', '🐯', '🐙'] as const

export type SubagentAvatar = (typeof SUBAGENT_AVATARS)[number]

export interface DelegateTaskInput {
  task: string
  skillIds?: string[]
  context?: string
}

export type DelegateTaskProgressStatus = 'running' | 'completed' | 'failed' | 'aborted'

export interface DelegateTaskProgress {
  runId: string
  name: string
  avatar?: SubagentAvatar
  task: string
  status: DelegateTaskProgressStatus
  summary?: string
}

export interface DelegateTaskResult {
  runId: string
  status: 'completed' | 'failed'
  name?: string
  avatar?: SubagentAvatar
  result?: string
  artifactIds?: string[]
}
