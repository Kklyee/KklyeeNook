import type {
  PiClientEvent,
  PiHostUiResponse,
  PiSendMessageInput,
  PiThinkingLevel,
} from '@assistant-ui/react-pi'

export interface PiThreadRequest {
  threadId: string
}

export interface PiSendMessageRequest extends PiThreadRequest {
  input: PiSendMessageInput
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

export interface PiHostUiResponseRequest extends PiThreadRequest {
  response: PiHostUiResponse
}

export interface PiSubscribeRequest extends PiThreadRequest {
  options?: { includeSnapshot?: boolean }
}

export type PiSubscriptionListener = (event: PiClientEvent) => void
