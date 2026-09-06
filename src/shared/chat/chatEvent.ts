export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export interface ChatRequest {
  messages: ChatMessage[];
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AssistantStreamApi {
  streamChat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void): () => void;
}
