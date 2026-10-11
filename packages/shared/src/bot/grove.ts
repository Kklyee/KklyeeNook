export type BotMessage = {
  id: string
  fromBotId: string
  toBotId: string
  type: 'message' | 'task' | 'result'
  content: string
  correlationId?: string
  createdAt: number
  remote?: 'incoming' | 'outgoing'
}

export type BotTask = {
  id: string
  fromBotId: string
  toBotId: string
  instruction: string
  status: 'pending' | 'accepted' | 'running' | 'completed' | 'failed' | 'rejected'
  result?: string
  sourceThreadId: string
  targetThreadId?: string
  submissionId?: number
  chainId: string
  parentTaskId?: string
  depth: number
  deadline: number
  createdAt: number
  updatedAt: number
  remote?: { direction: 'incoming' | 'outgoing'; operationId?: string }
}

export type BotReceptionPolicy = {
  messages: boolean
  tasks: boolean
  allowedBotIds: string[] | null
}

export const GROVE_LIMITS = {
  depth: 2,
  children: 3,
  activePerBot: 4,
  tasksPerChain: 8,
  modelCalls: 24,
  messagesPerMinute: 30,
  timeoutMs: 300_000,
} as const

export const GROVE_TOOLS = ['bot.send_message', 'bot.request_task', 'bot.get_task'] as const

export const defaultReceptionPolicy: BotReceptionPolicy = {
  messages: true,
  tasks: true,
  allowedBotIds: null,
}
