export interface DelegateTaskInput {
  task: string
  skillIds?: string[]
  context?: string
}

export interface DelegateTaskResult {
  runId: string
  status: 'completed' | 'failed'
  result?: string
  artifactIds?: string[]
}
