import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { WorkspacePreviewService } from './workspacePreviewService'

let directory: string
let root: string
let outside: string
let service: WorkspacePreviewService

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-preview-'))
  root = join(directory, 'workspace')
  outside = join(directory, 'outside')
  await mkdir(root)
  await mkdir(outside)
  service = new WorkspacePreviewService(async (sessionId) => ({
    conversationId: sessionId,
    workspace: { id: 'workspace', rootPath: root },
  }))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

test('reads complete relative and absolute text files within the session workspace', async () => {
  await writeFile(join(root, 'README.md'), '# Hello\n你好\n')
  for (const path of ['README.md', join(root, 'README.md')]) {
    await expect(service.readWorkspaceFile({ sessionId: 'session', path })).resolves.toMatchObject({
      kind: 'text',
      filename: 'README.md',
      mimeType: 'text/markdown',
      content: '# Hello\n你好\n',
    })
  }
})

test('rejects traversal, absolute paths outside the root, and sibling paths sharing the root prefix', async () => {
  for (const path of [
    '../outside/file.txt',
    '..\\outside\\file.txt',
    join(outside, 'file.txt'),
    `${root}-other/file.txt`,
  ]) {
    await expect(service.readWorkspaceFile({ sessionId: 'session', path })).rejects.toThrow(
      '工作区外',
    )
  }
})

test('rejects a junction escape including nonexistent descendants', async () => {
  await writeFile(join(outside, 'secret.txt'), 'secret')
  await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  for (const path of ['link/secret.txt', 'link/missing/nested.txt']) {
    await expect(service.readWorkspaceFile({ sessionId: 'session', path })).rejects.toThrow(
      '工作区外',
    )
  }
})

test('rejects a file symlink escape and allows a file symlink within the workspace', async (context) => {
  await writeFile(join(outside, 'secret.txt'), 'secret')
  await writeFile(join(root, 'safe.txt'), 'safe')
  try {
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'), 'file')
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('Windows file symlink privilege is unavailable')
    }
    throw error
  }
  await symlink(join(root, 'safe.txt'), join(root, 'alias.txt'), 'file')
  await expect(
    service.readWorkspaceFile({ sessionId: 'session', path: 'escape.txt' }),
  ).rejects.toThrow('工作区外')
  await expect(
    service.readWorkspaceFile({ sessionId: 'session', path: 'alias.txt' }),
  ).resolves.toMatchObject({ kind: 'text', content: 'safe' })
})

test('rejects sessions without an available workspace', async () => {
  const missing = new WorkspacePreviewService(async (conversationId) => ({ conversationId }))
  await expect(missing.readWorkspaceFile({ sessionId: 'session', path: 'a.txt' })).rejects.toThrow(
    '工作区不可用',
  )
  await rm(root, { recursive: true })
  await expect(service.readWorkspaceFile({ sessionId: 'session', path: 'a.txt' })).rejects.toThrow(
    '工作区不可用',
  )
})

test('returns a missing state for files that disappeared or never existed', async () => {
  await writeFile(join(root, 'deleted.txt'), 'gone')
  await rm(join(root, 'deleted.txt'))
  for (const path of ['deleted.txt', 'missing/nested.txt']) {
    await expect(service.readWorkspaceFile({ sessionId: 'session', path })).resolves.toMatchObject({
      kind: 'missing',
    })
  }
})

test('returns supported image files as base64', async () => {
  const data = Buffer.from([137, 80, 78, 71])
  for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']) {
    const path = `image.${extension}`
    await writeFile(join(root, path), data)
    await expect(service.readWorkspaceFile({ sessionId: 'session', path })).resolves.toMatchObject({
      kind: 'image',
      size: 4,
      base64: data.toString('base64'),
    })
  }
})

test('accepts text at the size limit and refuses oversized text and images without truncation', async () => {
  await writeFile(join(root, 'limit.txt'), 'a'.repeat(2 * 1024 * 1024))
  const exact = await service.readWorkspaceFile({ sessionId: 'session', path: 'limit.txt' })
  expect(exact.kind === 'text' && exact.content.length).toBe(2 * 1024 * 1024)
  for (const [path, size] of [
    ['large.txt', 2 * 1024 * 1024 + 1],
    ['large.png', 10 * 1024 * 1024 + 1],
  ] as const) {
    await writeFile(join(root, path), '')
    await truncate(join(root, path), size)
    await expect(service.readWorkspaceFile({ sessionId: 'session', path })).resolves.toMatchObject({
      kind: 'unsupported',
      reason: 'too-large',
      size,
    })
  }
})

test('refuses unsupported formats and binary files', async () => {
  await writeFile(join(root, 'file.pdf'), '%PDF')
  await writeFile(join(root, 'binary.txt'), Buffer.from([0, 255]))
  for (const path of ['file.pdf', 'binary.txt', '.']) {
    await expect(service.readWorkspaceFile({ sessionId: 'session', path })).resolves.toMatchObject({
      kind: 'unsupported',
      reason: 'format',
    })
  }
})

test('rereads the current workspace contents after edits', async () => {
  await writeFile(join(root, 'file.ts'), 'before')
  await service.readWorkspaceFile({ sessionId: 'session', path: 'file.ts' })
  await writeFile(join(root, 'file.ts'), 'after')
  await expect(
    service.readWorkspaceFile({ sessionId: 'session', path: 'file.ts' }),
  ).resolves.toMatchObject({ kind: 'text', content: 'after' })
})
