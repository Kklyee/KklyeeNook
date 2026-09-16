import type {
  PiClientEvent,
  PiHostUiResponse,
  PiSendMessageInput,
  PiThinkingLevel,
} from '@assistant-ui/react-pi'
import type { ContextAwarePiClient } from './piClient'

type PiClientMethod = Exclude<keyof ContextAwarePiClient, 'subscribe'>

export type PiClientCall = {
  [Method in PiClientMethod]: {
    method: Method
    args: Parameters<ContextAwarePiClient[Method]>
  }
}[PiClientMethod]

export interface PiSubscribeRequest {
  threadId: string
  options?: { includeSnapshot?: boolean }
}

export type PiSubscriptionListener = (event: PiClientEvent) => void

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
  response: PiHostUiResponse
}
