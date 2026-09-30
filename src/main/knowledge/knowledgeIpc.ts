import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { AgentBackendProcess } from '@/main/agent-backend/process'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type {
  KnowledgeReadResult,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
  KnowledgeSource,
} from '@/shared/knowledge/knowledge'

export function registerKnowledgeIpc(
  window: BrowserWindow,
  backend: AgentBackendProcess,
  workspace: () => string,
): () => void {
  const assertSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Untrusted Knowledge IPC sender')
  }
  const channels: string[] = []
  const handle = <T>(channel: string, action: (request: T) => unknown) => {
    const handler = (event: IpcMainInvokeEvent, request: T) => {
      assertSender(event)
      return action(request)
    }
    ipcMain.handle(channel, handler)
    channels.push(channel)
  }
  handle(IPC_CHANNELS.KNOWLEDGE_LIST, () =>
    backend.request<KnowledgeSource[]>({ action: 'knowledge:list' }),
  )
  handle(IPC_CHANNELS.KNOWLEDGE_ADD, (input: { path: string; kind: KnowledgeSource['kind'] }) =>
    backend.request<KnowledgeSource>({ action: 'knowledge:add', ...input }),
  )
  handle(IPC_CHANNELS.KNOWLEDGE_PICK, async (kind: KnowledgeSource['kind']) => {
    const paths =
      kind === 'workspace'
        ? [workspace()]
        : (
            await dialog.showOpenDialog(window, {
              properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
              filters:
                kind === 'file'
                  ? [
                      {
                        name: 'Knowledge documents',
                        extensions: [
                          'pdf',
                          'docx',
                          'pptx',
                          'xlsx',
                          'md',
                          'txt',
                          'html',
                          'ts',
                          'js',
                          'py',
                          'java',
                          'go',
                          'rs',
                        ],
                      },
                    ]
                  : undefined,
            })
          ).filePaths
    const sources: KnowledgeSource[] = []
    for (const path of paths)
      sources.push(await backend.request({ action: 'knowledge:add', path, kind }))
    return sources
  })
  handle(IPC_CHANNELS.KNOWLEDGE_REINDEX, (sourceId: string) =>
    backend.request({ action: 'knowledge:reindex', sourceId }),
  )
  handle(IPC_CHANNELS.KNOWLEDGE_REMOVE, (sourceId: string) =>
    backend.request({ action: 'knowledge:remove', sourceId }, 15 * 60_000),
  )
  handle(IPC_CHANNELS.KNOWLEDGE_SEARCH, (input: KnowledgeSearchRequest) =>
    backend.request<KnowledgeSearchResult[]>({ action: 'knowledge:search', input }, 15 * 60_000),
  )
  handle(IPC_CHANNELS.KNOWLEDGE_READ, (chunkId: string) =>
    backend.request<KnowledgeReadResult>({ action: 'knowledge:read', chunkId }),
  )
  handle(IPC_CHANNELS.KNOWLEDGE_OPEN, async (chunkId: string) => {
    const result = await backend.request<KnowledgeReadResult>({ action: 'knowledge:read', chunkId })
    const error = await shell.openPath(result.chunk.citation.filePath)
    if (error) throw new Error(error)
  })
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
