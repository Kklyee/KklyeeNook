import { expect, test, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { AgentBackendProcess } from '@/main/agent-backend/process'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import { registerKnowledgeIpc } from './knowledgeIpc'

const { handlers, removeHandler, openPath, showOpenDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  removeHandler: vi.fn(),
  openPath: vi.fn(async () => ''),
  showOpenDialog: vi.fn(async () => ({ filePaths: ['/docs/report.pdf', '/docs/notes.docx'] })),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    removeHandler,
  },
  dialog: { showOpenDialog },
  shell: { openPath },
}))

test('imports files through trusted IPC and opens only the stored citation path', async () => {
  const webContents = { mainFrame: {} }
  const window = { webContents } as unknown as BrowserWindow
  const sender = {
    sender: webContents,
    senderFrame: webContents.mainFrame,
  } as unknown as IpcMainInvokeEvent
  const request = vi.fn(async (input: { action: string }) =>
    input.action === 'knowledge:read'
      ? { chunk: { citation: { filePath: '/docs/architecture.pdf' } } }
      : { id: 'source' },
  )
  const dispose = registerKnowledgeIpc(
    window,
    { request } as unknown as AgentBackendProcess,
    () => '/workspace',
  )
  const picked = await handlers.get(IPC_CHANNELS.KNOWLEDGE_PICK)!(sender, 'file')
  expect(picked).toHaveLength(2)
  expect(request).toHaveBeenCalledWith({
    action: 'knowledge:add',
    path: '/docs/notes.docx',
    kind: 'file',
  })
  await handlers.get(IPC_CHANNELS.KNOWLEDGE_OPEN)!(sender, 'chunk')
  expect(openPath).toHaveBeenCalledWith('/docs/architecture.pdf')
  expect(() => handlers.get(IPC_CHANNELS.KNOWLEDGE_LIST)!({ sender: {}, senderFrame: {} })).toThrow(
    'Untrusted',
  )
  dispose()
  expect(removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.KNOWLEDGE_SEARCH)
})
