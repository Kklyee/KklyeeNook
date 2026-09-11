import { createHash } from 'node:crypto'

import type { PiAgentMessage } from '@assistant-ui/react-pi/node'

import type { AgentMessageProjection } from '@/shared/agent/agentMessage'
import type { AgentMessageRepo } from '../db/repositories/agentMessageRepo'

export class MessageProjectionService {
  constructor(private readonly repo: AgentMessageRepo) {}

  async project(sessionId: string, messages: readonly PiAgentMessage[]): Promise<void> {
    const projections: AgentMessageProjection[] = []
    let parentId: string | null = null

    const duplicateCounts = new Map<string, number>()
    messages.forEach((message) => {
      if (message.role !== 'user' && message.role !== 'assistant') return
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(message))
        .digest('hex')
        .slice(0, 24)
      const occurrence = duplicateCounts.get(fingerprint) ?? 0
      duplicateCounts.set(fingerprint, occurrence + 1)
      const id = `pi-msg:${fingerprint}:${occurrence}`
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
