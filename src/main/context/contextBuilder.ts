import type { ContextAttachmentRef } from '@/shared/context/contextAttachment'
import type {
  ContextAttachmentService,
  ResolvedContextAttachment,
} from './contextAttachmentService'

export interface AgentRunContextAttachment extends ContextAttachmentRef {
  text: string
}

export interface AgentRunContext {
  attachments: AgentRunContextAttachment[]
}

export class ContextBuilder {
  constructor(private readonly attachmentService: ContextAttachmentService) {}

  build(attachmentIds: readonly string[]): AgentRunContext | undefined {
    if (!attachmentIds.length) {
      return undefined
    }

    const attachments: ResolvedContextAttachment[] = this.attachmentService.resolve(attachmentIds)

    return {
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        text: attachment.text,
      })),
    }
  }
}
