import type { ThreadMessageLike } from '@assistant-ui/react'
import type { HistoryRecord } from './chat-protocol'

type Part = Exclude<ThreadMessageLike['content'], string>[number]

export function projectHistory(records: readonly HistoryRecord[]): ThreadMessageLike[] {
  return records.flatMap((record) => {
    if (record.kind === 'header') return []
    const payload = record.payload as Record<string, unknown> | null
    if (!payload || typeof payload !== 'object') return []
    const message = (payload.message ?? payload) as Record<string, unknown>
    const parts: Part[] = []
    if (record.role === 'tool') parts.push({ type: 'text', text: '历史工具输出（只读）\n' })
    if (typeof message.content === 'string') parts.push({ type: 'text', text: message.content })
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text' && typeof part.text === 'string') parts.push({ type: 'text', text: part.text })
        else if (part.type === 'thinking' && typeof part.thinking === 'string') parts.push({ type: 'reasoning', text: part.thinking })
        else if (part.type === 'image' && typeof part.data === 'string') parts.push({ type: 'image', image: `data:${part.mimeType};base64,${part.data}` })
        else if (part.type === 'toolCall') parts.push({ type: 'text', text: `历史工具调用（未重放）：${part.name} ${JSON.stringify(part.arguments)}` })
      }
    }
    if (!parts.length && typeof payload.summary === 'string') parts.push({ type: 'text', text: payload.summary })
    if (!parts.length && record.kind === 'diagnostic') parts.push({ type: 'text', text: `历史记录读取诊断：${String(payload.message ?? '')}` })
    if (!parts.length) return []
    return [{
      id: `history:${record.id}`, role: record.role === 'user' ? 'user' : 'assistant',
      createdAt: new Date(record.createdAt), content: parts,
      ...(record.role === 'user' ? {} : { status: { type: 'complete' as const, reason: 'stop' as const } }),
      metadata: { custom: { historical: true } },
    }]
  })
}
