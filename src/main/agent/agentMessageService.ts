import type { AgentMessageSnapshot } from '@/shared/chat/chatHistory'

import type { AgentMessageRepo } from '../db/repo/agentMessageRepo'

export class AgentMessageService {
  constructor(private readonly repo: AgentMessageRepo) {}

  async list(sessionId: string): Promise<AgentMessageSnapshot[]> {
    return this.repo.findBySessionId(sessionId)
  }

  async save(message: AgentMessageSnapshot): Promise<void> {
    if (!message.id) {
      throw new Error('Message id is required')
    }

    if (!message.sessionId) {
      throw new Error('Message sessionId is required')
    }

    await this.repo.save(message)
  }
}
