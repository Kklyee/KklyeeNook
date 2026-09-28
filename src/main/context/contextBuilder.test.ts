import { expect, test } from 'vitest'

import type { AgentMemoryRepo } from '@/main/db/repositories/memoryRepo'
import { ContextBuilder } from './contextBuilder'
import { ContextAttachmentService } from './contextAttachmentService'

test('builds an immutable agent context from staged attachment ids', async () => {
  const service = new ContextAttachmentService()
  const builder = new ContextBuilder(service)
  const text = '# Notes\n'
  const attachment = service.stage({
    name: 'notes.md',
    mimeType: 'text/markdown',
    size: Buffer.byteLength(text),
    text,
  })

  await expect(builder.build([attachment.id])).resolves.toEqual({
    attachments: [{ ...attachment, text }],
  })
  await expect(builder.build([])).resolves.toBeUndefined()
})

test('fails when a context id is unknown', async () => {
  const builder = new ContextBuilder(new ContextAttachmentService())

  await expect(builder.build(['missing'])).rejects.toThrow('Context attachment not found: missing')
})

test('loads current memories even when no file attachments are staged', async () => {
  const memory = {
    id: 'memory-1',
    scope: 'global' as const,
    content: 'Use pnpm',
    createdAt: 1,
    updatedAt: 2,
  }
  const memoryRepo: AgentMemoryRepo = {
    list: async () => [memory],
    create: async () => memory,
    update: async () => memory,
    delete: async () => undefined,
  }
  const builder = new ContextBuilder(new ContextAttachmentService(), memoryRepo)

  await expect(builder.build([], 'C:/workspace')).resolves.toEqual({
    memories: [memory],
    attachments: [],
  })
})
