import { expect, test } from 'vitest'

import { ContextBuilder } from './contextBuilder'
import { ContextAttachmentService } from './contextAttachmentService'

test('builds an immutable agent context from staged attachment ids', () => {
  const service = new ContextAttachmentService()
  const builder = new ContextBuilder(service)
  const text = '# Notes\n'
  const attachment = service.stage({
    name: 'notes.md',
    mimeType: 'text/markdown',
    size: Buffer.byteLength(text),
    text,
  })

  expect(builder.build([attachment.id])).toEqual({
    attachments: [{ ...attachment, text }],
  })
  expect(builder.build([])).toBeUndefined()
})

test('fails when a context id is unknown', () => {
  const builder = new ContextBuilder(new ContextAttachmentService())

  expect(() => builder.build(['missing'])).toThrow('Context attachment not found: missing')
})
