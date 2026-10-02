import { afterEach, expect, test, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { WorkspacePreviewService } from './workspacePreviewService'

const { handle, removeHandler } = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle, removeHandler } }))
import { registerPreviewIpc } from './previewIpc'

afterEach(() => vi.clearAllMocks())

test('allows only the application main frame and removes the handler on disposal', async () => {
  const mainFrame = {}
  const webContents = { mainFrame }
  const readWorkspaceFile = vi
    .fn()
    .mockResolvedValue({ kind: 'missing', path: 'a.txt', filename: 'a.txt' })
  const dispose = registerPreviewIpc(
    { webContents } as BrowserWindow,
    { readWorkspaceFile } as unknown as WorkspacePreviewService,
  )
  expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.PREVIEW_WORKSPACE_FILE, expect.any(Function))
  const handler = handle.mock.calls[0]![1]
  const request = { sessionId: 'session', path: 'a.txt' }
  await handler({ sender: webContents, senderFrame: mainFrame }, request)
  expect(readWorkspaceFile).toHaveBeenCalledWith(request)
  expect(() => handler({ sender: {}, senderFrame: mainFrame }, request)).toThrow('Untrusted')
  expect(() => handler({ sender: webContents, senderFrame: {} }, request)).toThrow('Untrusted')
  expect(readWorkspaceFile).toHaveBeenCalledTimes(1)
  dispose()
  expect(removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.PREVIEW_WORKSPACE_FILE)
})
