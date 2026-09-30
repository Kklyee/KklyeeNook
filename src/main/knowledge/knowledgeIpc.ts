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
  workspace: (id: string) => string | undefined | Promise<string | undefined>,
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
  handle(IPC_CHANNELS.KNOWLEDGE_ADD, (input: { path: string; kind: KnowledgeSource['kind']; workspaceId?: string }) =>
    backend.request<KnowledgeSource>({ action: 'knowledge:add', ...input }),
  )
  handle(IPC_CHANNELS.KNOWLEDGE_PICK, async (input: KnowledgeSource['kind'] | { kind: KnowledgeSource['kind']; workspaceId?: string }) => {
    const { kind, workspaceId } = typeof input === 'string' ? { kind: input, workspaceId: undefined } : input
    const paths =
      kind === 'workspace'
        ? [await workspace(workspaceId ?? '')]
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
    for (const path of paths) {
      if (!path) throw new Error('请选择关联的项目')
      sources.push(await backend.request({ action: 'knowledge:add', path, kind, workspaceId }))
    }
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
