import type { RemoteThreadListAdapter } from '@assistant-ui/react'
import { createAssistantStream } from 'assistant-stream'
import type { AgentSessionSummary } from '@/shared/agent/agentSession'

function toRemoteThreadMetadata(session: AgentSessionSummary) {
  return {
    remoteId: session.id,
    status: 'regular' as const,
    title: session.title,

    custom: {
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      activeRunId: session.activeRunId,
    },
  }
}

export const threadListAdapter = {
  async list() {
    const sessions = await window.api.listAgentSessions()
    return { threads: sessions.map(toRemoteThreadMetadata) }
  },

  async initialize(_localId: string) {
    const session = await window.api.createAgentSession({ title: 'New Task' })
    return { remoteId: session.id }
  },
  async rename(remoteId: string, newTitle: string) {
    await window.api.renameAgentSession({ sessionId: remoteId, title: newTitle })
  },
  async delete(remoteId: string) {
    await window.api.deleteAgentSession({ sessionId: remoteId })
  },

  async fetch(remoteId: string) {
    const sessions = await window.api.listAgentSessions()

    const session = sessions.find((item) => item.id === remoteId)

    if (!session) {
      throw new Error(`AgentSession not found: ${remoteId}`)
    }

    return toRemoteThreadMetadata(session)
  },

  async archive() {
    throw new Error('Thread archive is not implemented yet')
  },

  async unarchive() {
    throw new Error('Thread unarchive is not implemented yet')
  },

  async generateTitle(remoteId, messages) {
    const firstUserMessage = messages.find((message) => message.role === 'user')
    const text = firstUserMessage?.content.find((part) => part.type === 'text')?.text.trim()
    const title = !text ? 'New Task' : text.length > 50 ? `${text.slice(0, 47)}...` : text

    await window.api.renameAgentSession({ sessionId: remoteId, title })

    return createAssistantStream((controller) => {
      controller.appendText(title)
    })
  },
} satisfies Pick<
  RemoteThreadListAdapter,
  'list' | 'initialize' | 'rename' | 'delete' | 'fetch' | 'archive' | 'unarchive' | 'generateTitle'
>
