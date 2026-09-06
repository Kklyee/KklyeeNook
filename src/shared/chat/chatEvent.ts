export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export interface ChatRequest {
  messages: ChatMessage[]
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_update'; toolCallId: string; partialResult: unknown }
  | { type: 'tool_end'; toolCallId: string; result: unknown; success: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface AssistantStreamApi {
  streamChat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void): () => void
}
