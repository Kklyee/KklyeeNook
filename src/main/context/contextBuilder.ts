import type { ContextAttachmentRef } from '@/shared/context/contextAttachment'
import type { AgentMemory } from '@/shared/memory/agentMemory'
import type { AgentMemoryRepo } from '@/main/db/repositories/memoryRepo'
import type {
  ContextAttachmentService,
  ResolvedContextAttachment,
} from './contextAttachmentService'

export interface AgentRunContextAttachment extends ContextAttachmentRef {
  text: string
}

export interface AgentRunContext {
  attachments: AgentRunContextAttachment[]
  memories?: AgentMemory[]
}

export class ContextBuilder {
  constructor(
    private readonly attachmentService: ContextAttachmentService,
    private readonly memoryRepo?: AgentMemoryRepo,
  ) {}

  async build(
    attachmentIds: readonly string[],
    workspacePath?: string,
  ): Promise<AgentRunContext | undefined> {
    const attachments: ResolvedContextAttachment[] = attachmentIds.length
      ? this.attachmentService.resolve(attachmentIds)
      : []
    const memories = (await this.memoryRepo?.list(workspacePath)) ?? []

    if (!attachments.length && !memories.length) return undefined

    return {
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        text: attachment.text,
      })),
      ...(memories.length ? { memories } : {}),
    }
  }
}
