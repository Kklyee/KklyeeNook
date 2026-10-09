import type { PiAgentMessage, PiAssistantMessage, PiHostUiRequest, PiThreadSnapshot } from '@assistant-ui/react-pi'
import type {
  RemoteApproval,
  RemoteConversationSnapshot,
  RemoteConversationSummary,
  RemoteMessage,
  RemoteQueueItem,
} from '@kklyeenook/shared/remote/index'

export function remoteMessage(input: PiAgentMessage, streaming = false): RemoteMessage | undefined {
  if (input.role !== 'user' && input.role !== 'assistant') return
  const timestamp = typeof input.timestamp === 'number' ? input.timestamp : 0
  const usage = input.role === 'assistant' ? (input as PiAssistantMessage).usage : undefined
  const content: RemoteMessage['content'] = []
  if (typeof input.content === 'string') content.push({ type: 'text', text: input.content })
  else if (Array.isArray(input.content)) {
    for (const part of input.content) {
      if (part.type === 'text') content.push({ type: 'text', text: part.text })
      if (part.type === 'thinking') content.push({ type: 'reasoning', text: part.thinking })
      if (part.type === 'toolCall') content.push({ type: 'data', name: 'tool-call', data: { toolCallId: part.id } })
      if (part.type === 'image' && /^image\/(png|jpeg|gif|webp)$/.test(part.mimeType)) {
        content.push({ type: 'image', image: `data:${part.mimeType};base64,${part.data}` })
      }
    }
  }
  return {
    id: `${input.role}:${timestamp}`,
    role: input.role,
    timestamp,
    content,
    ...(input.role === 'assistant' ? {
      ...(usage ? { usage: {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
      } } : {}),
      status: streaming ? 'running' : input.stopReason === 'error' ? 'failed' : input.stopReason === 'aborted' ? 'cancelled' : 'complete',
    } : {}),
  }
}

export function remoteApproval(input: PiHostUiRequest): RemoteApproval {
  const base = { id: input.id, title: input.title, timeoutMs: input.timeoutMs }
  switch (input.kind) {
    case 'confirm': return { ...base, kind: input.kind, message: input.message }
    case 'select': return { ...base, kind: input.kind, options: input.options }
    case 'input': return { ...base, kind: input.kind, placeholder: input.placeholder }
    case 'editor': return { ...base, kind: input.kind, prefill: input.prefill }
  }
}

export function remoteQueue(steering: readonly string[], followUp: readonly string[]): RemoteQueueItem[] {
  return [
    ...steering.map((text, index) => ({ id: `steer:${index}`, text, steer: true, index, expected: [...steering] })),
    ...followUp.map((text, index) => ({ id: `followUp:${index}`, text, steer: false, index, expected: [...followUp] })),
  ]
}

export function remoteSnapshot(
  input: PiThreadSnapshot,
  summary: RemoteConversationSummary,
  permission: RemoteConversationSnapshot['permission'],
): RemoteConversationSnapshot {
  const queue = input.metadata.queuedMessages ?? []
  return {
    ...summary,
    status: input.metadata.status === 'running' ? 'running' : input.metadata.status === 'failed' ? 'failed' : 'idle',
    permission,
    model: input.metadata.config?.provider && input.metadata.config.modelId
      ? { provider: input.metadata.config.provider, modelId: input.metadata.config.modelId }
      : undefined,
    thinkingLevel: input.metadata.config?.thinkingLevel ?? 'off',
    messages: input.messages.flatMap((message, index) => remoteMessage(message, input.metadata.status === 'running' && index === input.messages.length - 1) ?? []),
    activities: [],
    queue: remoteQueue(queue.filter(item => item.mode === 'steer').map(item => item.content), queue.filter(item => item.mode === 'followUp').map(item => item.content)),
    approvals: (input.hostUiRequests ?? []).map(remoteApproval),
    error: input.lastError,
  }
}
