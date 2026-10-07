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

export type PiQueueMutation = import('@kklyeenook/shared/remote/index').RemoteQueueMutation

export interface PiSubscribeRequest {
  threadId: string
  options?: { includeSnapshot?: boolean }
}
