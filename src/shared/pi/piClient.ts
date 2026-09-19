import type { PiClient, PiSendMessageInput } from '@assistant-ui/react-pi'

export type ContextAwarePiClient = Omit<PiClient, 'sendMessage'> & {
  sendMessage(
    threadId: string,
    input: PiSendMessageInput,
    contextAttachmentIds?: readonly string[],
  ): Promise<void>
}

export interface PiSubscribeRequest {
  threadId: string
  options?: { includeSnapshot?: boolean }
}
