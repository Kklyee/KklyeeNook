import type { PiAgentMessage } from '@assistant-ui/react-pi/node'

import type { AgentMessageProjection } from '@/shared/agent/agentMessage'
import type { AgentMessageRepo } from '../db/repositories/agentMessageRepo'

export class MessageProjectionService {
  constructor(private readonly repo: AgentMessageRepo) {}

  async project(sessionId: string, messages: readonly PiAgentMessage[]): Promise<void> {
    const projections: AgentMessageProjection[] = []
    let parentId: string | null = null

    messages.forEach((message, index) => {
      if (message.role !== 'user' && message.role !== 'assistant') return
      const id = `pi-msg:${index}`
      projections.push({
        id,
        sessionId,
        parentId,
        role: message.role,
        createdAt: typeof message.timestamp === 'number' ? message.timestamp : 0,
        payload: message,
      })
      parentId = id
    })

    await this.repo.replaceBySession(sessionId, projections)
  }
}
