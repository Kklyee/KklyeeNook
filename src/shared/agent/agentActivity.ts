import type { ToolCall, ToolExecutionResult } from '../tool/tool'

export type ActivityStatus = 'running' | 'completed' | 'failed' | 'waiting'

export interface ActivityTiming {
  startedAt?: number
  endedAt?: number
}

type ActivityBase = ActivityTiming & { id: string; status: ActivityStatus }
type ToolActivity = { call: ToolCall; result?: ToolExecutionResult }

export type AgentActivity = ActivityBase &
  (
    | { type: 'thinking'; content: string }
    | (ToolActivity & { type: 'read'; path?: string })
    | (ToolActivity & { type: 'search'; query?: string; resultCount?: number })
    | (ToolActivity & { type: 'glob'; pattern?: string; resultCount?: number })
    | (ToolActivity & {
        type: 'edit' | 'write'
        path?: string
        additions?: number
        deletions?: number
      })
    | (ToolActivity & { type: 'shell'; command?: string; exitCode?: number })
    | (ToolActivity & { type: 'approval'; label?: string })
    | (ToolActivity & { type: 'tool'; toolName: string })
  )
