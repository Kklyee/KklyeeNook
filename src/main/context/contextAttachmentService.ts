import { randomUUID } from 'node:crypto'

import type {
  ContextAttachmentRef,
  StageContextAttachmentRequest,
} from '@/shared/context/contextAttachment'

const MAX_FILE_BYTES = 512 * 1024
const MAX_CONTEXT_BYTES = 2 * 1024 * 1024

export interface ResolvedContextAttachment extends ContextAttachmentRef {
  text: string
}

export class ContextAttachmentService {
  private readonly attachments = new Map<string, ResolvedContextAttachment>()

  stage(request: StageContextAttachmentRequest): ContextAttachmentRef {
    const name = request.name.trim()
    if (!name) {
      throw new Error('Attachment name is required')
    }

    if (request.size <= 0) {
      throw new Error('Attachment is empty')
    }

    if (request.size > MAX_FILE_BYTES) {
      throw new Error('Attachment must be smaller than 512 KB')
    }

    const actualBytes = Buffer.byteLength(request.text, 'utf8')

    if (actualBytes > MAX_FILE_BYTES) {
      throw new Error('Attachment text must be smaller than 512 KB')
    }

    const id = randomUUID()

    const attachment: ResolvedContextAttachment = {
      id,
      name,
      mimeType: request.mimeType || 'text/plain',
      size: request.size,
      text: request.text,
    }

    this.attachments.set(id, attachment)

    return { id, name: attachment.name, mimeType: attachment.mimeType, size: attachment.size }
  }

  resolve(ids: readonly string[]): ResolvedContextAttachment[] {
    const uniqueIds = [...new Set(ids)]

    const attachments = uniqueIds.map((id) => {
      const attachment = this.attachments.get(id)

      if (!attachment) {
        throw new Error(`Context attachment not found: ${id}`)
      }

      return attachment
    })

    const totalBytes = attachments.reduce(
      (total, attachment) => total + Buffer.byteLength(attachment.text, 'utf8'),
      0,
    )

    if (totalBytes > MAX_CONTEXT_BYTES) {
      throw new Error('Total attachment context must be smaller than 2 MB')
    }

    return attachments
  }

  remove(id: string): void {
    this.attachments.delete(id)
  }

  release(ids: readonly string[]): void {
    for (const id of ids) {
      this.attachments.delete(id)
    }
  }

  clear(): void {
    this.attachments.clear()
  }
}
