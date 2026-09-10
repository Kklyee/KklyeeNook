import type { ThreadHistoryAdapter } from '@assistant-ui/react'
import type { AgentMessageSnapshot } from '@/shared/chat/chatHistory'

type HistoryItem = Parameters<ThreadHistoryAdapter['append']>[0]

interface Options {
  getSessionId: () => string | undefined
  ensureSessionId: () => Promise<string>
}

function serializeHistoryItem(sessionId: string, item: HistoryItem): AgentMessageSnapshot {
  const { id, role, createdAt, ...payload } = item.message

  return {
    id,
    sessionId,
    parentId: item.parentId,
    role,
    createdAt: createdAt.getTime(),
    payload,
    runConfig: item.runConfig,
  }
}

function deserializeHistoryItem(record: AgentMessageSnapshot): HistoryItem {
  const payload = record.payload as Record<string, unknown>

  return {
    parentId: record.parentId,
    runConfig: record.runConfig as HistoryItem['runConfig'],
    message: {
      ...payload,
      id: record.id,
      role: record.role,
      createdAt: new Date(record.createdAt),
    } as HistoryItem['message'],
  }
}

export function createThreadHistoryAdapter(options: Options): ThreadHistoryAdapter {
  return {
    async load() {
      const sessionId = options.getSessionId()

      if (!sessionId) {
        return { messages: [] }
      }

      const messages = await window.api.loadAgentMessages({ sessionId })

      return { messages: messages.map(deserializeHistoryItem) }
    },

    async append(item) {
      const sessionId = await options.ensureSessionId()
      const message = serializeHistoryItem(sessionId, item)
      await window.api.saveAgentMessage(message)
    },
  }
}
