import type {
  Attachment,
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from '@assistant-ui/react'
import { CompositeAttachmentAdapter, SimpleImageAttachmentAdapter } from '@assistant-ui/react'
import type { ContextAttachmentRef } from '@/shared/context/contextAttachment'
import {
  forgetPendingContextAttachment,
  rememberPendingContextAttachment,
} from './pendingContextAttachments'

const TEXT_ATTACHMENT_ACCEPT = [
  'text/*',
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  '.txt',
  '.md',
  '.markdown',
  '.mdx',
  '.json',
  '.jsonl',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.log',
  '.sql',
  '.sh',
  '.bash',
  '.bat',
  '.cmd',
  '.ps1',
  '.py',
  '.rb',
  '.php',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.swift',
  '.graphql',
  '.gql',
  '.proto',
  '.diff',
  '.patch',
  '.lock',
  '.gitignore',
  '.gitattributes',
  '.dockerfile',
].join(',')

const textContextAttachmentAdapter: AttachmentAdapter = {
  accept: TEXT_ATTACHMENT_ACCEPT,

  async add({ file }): Promise<PendingAttachment> {
    const staged: ContextAttachmentRef = await window.api.context.stage({
      name: file.name,
      mimeType: file.type || 'text/plain',
      size: file.size,
      text: await file.text(),
    })

    return {
      id: staged.id,
      type: 'document',
      name: staged.name,
      contentType: staged.mimeType,
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    }
  },

  send(attachment): Promise<CompleteAttachment> {
    rememberPendingContextAttachment(attachment.id)

    return Promise.resolve({
      ...attachment,
      status: { type: 'complete' },
      content: [],
    })
  },

  async remove(attachment: Attachment): Promise<void> {
    forgetPendingContextAttachment(attachment.id)
    await window.api.context.remove({ id: attachment.id })
  },
}

const contextAttachmentAdapter = new CompositeAttachmentAdapter([
  textContextAttachmentAdapter,
  new SimpleImageAttachmentAdapter(),
])

export { TEXT_ATTACHMENT_ACCEPT, contextAttachmentAdapter }
