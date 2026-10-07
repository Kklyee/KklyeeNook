import { CompositeAttachmentAdapter, SimpleImageAttachmentAdapter, type AttachmentAdapter, type CompleteAttachment } from '@assistant-ui/react'
import { REMOTE_ATTACHMENT_LIMITS, TEXT_ATTACHMENT_ACCEPT, type RemoteFileAttachment } from '@kklyeenook/shared/remote/attachments'

const textAdapter: AttachmentAdapter = {
  accept: TEXT_ATTACHMENT_ACCEPT,
  async add({ file }) {
    if (!file.size || file.size > REMOTE_ATTACHMENT_LIMITS.textBytes) throw new Error('文本附件需小于 512 KB')
    return { id: crypto.randomUUID(), type: 'document', name: file.name, contentType: file.type || 'text/plain', file, status: { type: 'requires-action', reason: 'composer-send' } }
  },
  async send(attachment) {
    return { ...attachment, status: { type: 'complete' }, content: [{ type: 'text', text: await attachment.file.text() }] }
  },
  async remove() {},
}

class ImageAdapter extends SimpleImageAttachmentAdapter {
  override accept = 'image/png,image/jpeg,image/gif,image/webp'
  override async add({ file }: { file: File }) {
    if (!file.size || file.size > REMOTE_ATTACHMENT_LIMITS.imageBytes) throw new Error('图片附件需小于 5 MB')
    return super.add({ file })
  }
}

export const remoteAttachmentAdapter = new CompositeAttachmentAdapter([textAdapter, new ImageAdapter()])

export function serializeAttachments(attachments: readonly CompleteAttachment[]): RemoteFileAttachment[] {
  if (attachments.length > REMOTE_ATTACHMENT_LIMITS.files) throw new Error('最多添加 8 个附件')
  return attachments.map(attachment => {
    const image = attachment.content.find(part => part.type === 'image')
    if (image) {
      const match = /^data:([^;]+);base64,(.+)$/s.exec(image.image)
      if (!match) throw new Error('图片数据无效')
      return { type: 'image', name: attachment.name, mimeType: match[1], size: attachment.file?.size ?? atob(match[2]).length, data: match[2] }
    }
    const text = attachment.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    return { type: 'text', name: attachment.name, mimeType: attachment.contentType ?? 'text/plain', size: attachment.file?.size ?? new TextEncoder().encode(text).length, text }
  })
}
