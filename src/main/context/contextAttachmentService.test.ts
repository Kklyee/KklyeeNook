import { expect, test } from 'vitest'

import { ContextAttachmentService } from './contextAttachmentService'

test('stages, resolves, deduplicates, and releases text attachments', () => {
  const service = new ContextAttachmentService()
  const text = 'const answer = 42\n'
  const attachment = service.stage({
    name: ' answer.ts ',
    mimeType: 'text/typescript',
    size: Buffer.byteLength(text),
    text,
  })

  expect(attachment).toMatchObject({
    name: 'answer.ts',
    mimeType: 'text/typescript',
    size: text.length,
  })
  expect(service.resolve([attachment.id, attachment.id])).toEqual([
    { ...attachment, text },
  ])

  service.release([attachment.id])
  expect(() => service.resolve([attachment.id])).toThrow(
    `Context attachment not found: ${attachment.id}`,
  )
})

test('rejects empty, oversized, and invalidly named attachments', () => {
  const service = new ContextAttachmentService()

  expect(() =>
    service.stage({ name: 'empty.txt', mimeType: 'text/plain', size: 0, text: '' }),
  ).toThrow('Attachment is empty')
  expect(() =>
    service.stage({ name: '   ', mimeType: 'text/plain', size: 1, text: 'x' }),
  ).toThrow('Attachment name is required')
  expect(() =>
    service.stage({
      name: 'large.txt',
      mimeType: 'text/plain',
      size: 512 * 1024 + 1,
      text: 'x',
    }),
  ).toThrow('Attachment must be smaller than 512 KB')
  expect(() =>
    service.stage({
      name: 'large-content.txt',
      mimeType: 'text/plain',
      size: 1,
      text: 'x'.repeat(512 * 1024 + 1),
    }),
  ).toThrow('Attachment text must be smaller than 512 KB')
})
