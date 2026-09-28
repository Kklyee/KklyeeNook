export type ScheduledTaskSchedule =
  | { type: 'once'; runAt: number }
  | { type: 'daily'; time: string }
  | { type: 'weekly'; weekday: number; time: string }

export interface ScheduledTask {
  id: string
  title: string
  prompt: string
  schedule: ScheduledTaskSchedule
  enabled: boolean
  sessionId?: string
  skillIds?: string[]
  lastRunAt?: number
  nextRunAt?: number
  createdAt: number
  updatedAt: number
}

export interface CreateScheduledTaskInput {
  title: string
  prompt: string
  schedule: ScheduledTaskSchedule
  enabled?: boolean
  sessionId?: string
  skillIds?: string[]
}

export interface UpdateScheduledTaskInput {
  title?: string
  prompt?: string
  schedule?: ScheduledTaskSchedule
  enabled?: boolean
  sessionId?: string | null
  skillIds?: string[]
}
