import { acceptsTextAttachment, REMOTE_ATTACHMENT_LIMITS, type RemoteFileAttachment } from '@kklyeenook/shared/remote/attachments'
import { RemoteError } from './remoteAgentPort'

export function validateRemoteAttachments(input: unknown): RemoteFileAttachment[] {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > REMOTE_ATTACHMENT_LIMITS.files) throw new RemoteError(400, '最多添加 8 个附件')
  let total = 0
  return input.map(file => {
    if (!file || typeof file.name !== 'string' || !file.name.trim() || typeof file.mimeType !== 'string' || !Number.isSafeInteger(file.size) || file.size <= 0) throw new RemoteError(400, '附件信息无效')
    const base = { name: file.name.trim(), mimeType: file.mimeType, size: file.size }
    let result: RemoteFileAttachment
    if (file.type === 'text' && typeof file.text === 'string' && acceptsTextAttachment(base.name, base.mimeType)) {
      const bytes = Buffer.byteLength(file.text, 'utf8')
      if (Math.max(bytes, base.size) > REMOTE_ATTACHMENT_LIMITS.textBytes) throw new RemoteError(400, '文本附件不能超过 512 KB')
      total += Math.max(bytes, base.size)
      result = { ...base, type: 'text', text: file.text }
    } else if (file.type === 'image' && typeof file.data === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(base.mimeType)) {
      const bytes = Buffer.from(file.data, 'base64')
      if (bytes.length !== base.size || bytes.toString('base64') !== file.data) throw new RemoteError(400, '图片数据无效')
      if (bytes.length > REMOTE_ATTACHMENT_LIMITS.imageBytes) throw new RemoteError(400, '图片附件不能超过 5 MB')
      total += bytes.length
      result = { ...base, type: 'image', data: file.data }
    } else throw new RemoteError(400, '请选择图片、文本或代码文件')
    if (total > REMOTE_ATTACHMENT_LIMITS.totalBytes) throw new RemoteError(400, '附件总大小不能超过 10 MB')
    return result
  })
}
