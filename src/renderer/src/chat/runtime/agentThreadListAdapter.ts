import type { RemoteThreadListAdapter } from '@assistant-ui/react'
import type { AgentSessionSummary } from '../../../../shared/agent/agentSession'

// type RemoteThreadMetadata = Awaited<ReturnType<RemoteThreadListAdapter['list']>>['threads'][number]

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

export const agentThreadListAdapter = {
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

  async generateTitle() {
    throw new Error('Thread title generation is not implemented yet')
  },
} satisfies Pick<
  RemoteThreadListAdapter,
  'list' | 'initialize' | 'rename' | 'delete' | 'fetch' | 'archive' | 'unarchive' | 'generateTitle'
>
