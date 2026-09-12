import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { PiClient } from '@assistant-ui/react-pi'

import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type {
  ContextAwarePiClient,
  PiExtensionUiResponseRequest,
  PiRenameThreadRequest,
  PiSendMessageRequest,
  PiSetModelRequest,
  PiSetThinkingLevelRequest,
  PiSubscribeRequest,
  PiThreadRequest,
} from '@/shared/pi/piIpc'

export function registerPiClientIpc(window: BrowserWindow, client: ContextAwarePiClient): () => void {
  const assertTrusted = (event: IpcMainInvokeEvent | IpcMainEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Untrusted Pi IPC sender')
    }
  }
  const handle = <T>(
    channel: string,
    callback: (event: IpcMainInvokeEvent, input: T) => unknown,
  ) => {
    ipcMain.handle(channel, (event, input: T) => {
      assertTrusted(event)
      return callback(event, input)
    })
  }

  handle<Parameters<PiClient['listThreads']>[0]>(IPC_CHANNELS.PI_THREAD_LIST, (_event, input) =>
    client.listThreads(input),
  )
  handle<Parameters<PiClient['createThread']>[0]>(IPC_CHANNELS.PI_THREAD_CREATE, (_event, input) =>
    client.createThread(input),
  )
  handle<PiThreadRequest>(IPC_CHANNELS.PI_THREAD_GET, (_event, input) =>
    client.getThread(input.threadId),
  )
  handle<PiSendMessageRequest>(IPC_CHANNELS.PI_MESSAGE_SEND, (_event, request) =>
    client.sendMessage(request.threadId, request.input, request.contextAttachmentIds),
  )
  handle<PiThreadRequest>(IPC_CHANNELS.PI_RUN_CANCEL, (_event, request) =>
    client.cancelRun(request.threadId),
  )
  handle<PiThreadRequest>(IPC_CHANNELS.PI_QUEUE_CLEAR, (_event, request) =>
    client.clearQueue(request.threadId),
  )
  handle<Parameters<PiClient['getAvailableModels']>[0]>(
    IPC_CHANNELS.PI_MODEL_LIST,
    (_event, input) => client.getAvailableModels(input),
  )
  handle<PiSetModelRequest>(IPC_CHANNELS.PI_MODEL_SET, (_event, request) =>
    client.setModel(request.threadId, request.input),
  )
  handle<PiSetThinkingLevelRequest>(IPC_CHANNELS.PI_THINKING_SET, (_event, request) =>
    client.setThinkingLevel(request.threadId, request.level),
  )
  handle<PiRenameThreadRequest>(IPC_CHANNELS.PI_THREAD_RENAME, (_event, request) =>
    client.renameThread(request.threadId, request.title),
  )
  handle<PiThreadRequest>(IPC_CHANNELS.PI_THREAD_ARCHIVE, (_event, request) =>
    client.archiveThread(request.threadId),
  )
  handle<PiThreadRequest>(IPC_CHANNELS.PI_THREAD_UNARCHIVE, (_event, request) =>
    client.unarchiveThread(request.threadId),
  )
  handle<PiThreadRequest>(IPC_CHANNELS.PI_THREAD_DELETE, (_event, request) =>
    client.deleteThread(request.threadId),
  )
  handle<PiExtensionUiResponseRequest>(IPC_CHANNELS.PI_EXTENSION_UI_RESPOND, (_event, request) =>
    client.respondToHostUiRequest(request.threadId, request.response),
  )

  const subscribe = (event: IpcMainEvent, request: PiSubscribeRequest) => {
    const [port] = event.ports
    if (!port) return
    try {
      assertTrusted(event)
    } catch {
      port.close()
      return
    }
    const unsubscribe = client.subscribe(
      request.threadId,
      (clientEvent) => port.postMessage(clientEvent),
      request.options,
    )
    port.once('close', unsubscribe)
    port.start()
  }
  ipcMain.on(IPC_CHANNELS.PI_THREAD_SUBSCRIBE, subscribe)

  const channels = [
    IPC_CHANNELS.PI_THREAD_LIST,
    IPC_CHANNELS.PI_THREAD_CREATE,
    IPC_CHANNELS.PI_THREAD_GET,
    IPC_CHANNELS.PI_MESSAGE_SEND,
    IPC_CHANNELS.PI_RUN_CANCEL,
    IPC_CHANNELS.PI_QUEUE_CLEAR,
    IPC_CHANNELS.PI_MODEL_LIST,
    IPC_CHANNELS.PI_MODEL_SET,
    IPC_CHANNELS.PI_THINKING_SET,
    IPC_CHANNELS.PI_THREAD_RENAME,
    IPC_CHANNELS.PI_THREAD_ARCHIVE,
    IPC_CHANNELS.PI_THREAD_UNARCHIVE,
    IPC_CHANNELS.PI_THREAD_DELETE,
    IPC_CHANNELS.PI_EXTENSION_UI_RESPOND,
  ]
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
    ipcMain.removeListener(IPC_CHANNELS.PI_THREAD_SUBSCRIBE, subscribe)
  }
}
