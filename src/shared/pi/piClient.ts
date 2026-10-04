import type { PiClient, PiSendMessageInput } from '@assistant-ui/react-pi'

export type ContextAwarePiClient = Omit<PiClient, 'sendMessage'> & {
  updateQueuedMessage(threadId: string, input: PiQueueMutation): Promise<PiQueueSnapshot>
  sendMessage(
    threadId: string,
    input: PiSendMessageInput,
    contextAttachmentIds?: readonly string[],
  ): Promise<void>
}

export interface PiQueueSnapshot {
  steering: string[]
  followUp: string[]
}

export type PiQueueMutation = { mode: 'steer' | 'followUp'; expected: string[]; index: number } & (
  | { action: 'remove' }
  | { action: 'steer' }
  | { action: 'edit'; value: string }
  | { action: 'move'; value: number }
)

export interface PiSubscribeRequest {
  threadId: string
  options?: { includeSnapshot?: boolean }
}
