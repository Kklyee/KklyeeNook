export interface DelegateTaskInput {
  task: string
  skillIds?: string[]
  context?: string
}

export type DelegateTaskProgressStatus = 'running' | 'completed' | 'failed' | 'aborted'

export interface DelegateTaskProgress {
  runId: string
  name: string
  task: string
  status: DelegateTaskProgressStatus
  summary?: string
}

export interface DelegateTaskResult {
  runId: string
  status: 'completed' | 'failed'
  result?: string
  artifactIds?: string[]
}
