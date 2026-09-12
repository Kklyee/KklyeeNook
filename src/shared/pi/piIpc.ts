import type {
  PiClient,
  PiClientEvent,
  PiHostUiResponse as PiExtensionUiResponse,
  PiSendMessageInput,
  PiThinkingLevel,
} from '@assistant-ui/react-pi'

export type ContextAwarePiClient = Omit<PiClient, 'sendMessage'> & {
  sendMessage(
    threadId: string,
    input: PiSendMessageInput,
    contextAttachmentIds?: readonly string[],
  ): Promise<void>
}

export interface PiThreadRequest {
  threadId: string
}

export interface PiSendMessageRequest extends PiThreadRequest {
  input: PiSendMessageInput
  contextAttachmentIds?: readonly string[]
}

export interface PiSetModelRequest extends PiThreadRequest {
  input: { provider: string; modelId: string }
}

export interface PiSetThinkingLevelRequest extends PiThreadRequest {
  level: PiThinkingLevel
}

export interface PiRenameThreadRequest extends PiThreadRequest {
  title: string
}

export interface PiExtensionUiResponseRequest extends PiThreadRequest {
  response: PiExtensionUiResponse
}

export interface PiSubscribeRequest extends PiThreadRequest {
  options?: { includeSnapshot?: boolean }
}

export type PiSubscriptionListener = (event: PiClientEvent) => void
