import type { ContextAwarePiClient } from '@/shared/pi/piClient'
import type { PiClientCall } from '@/shared/pi/piIpc'
import type { AgentBackendProcess } from './process'

type PiClientMethod = Exclude<keyof ContextAwarePiClient, 'subscribe'>

export function createBackendPiClient(backend: AgentBackendProcess): ContextAwarePiClient {
  const call = <Method extends PiClientMethod>(
    method: Method,
    args: Parameters<ContextAwarePiClient[Method]>,
  ): Promise<Awaited<ReturnType<ContextAwarePiClient[Method]>>> =>
    backend.request({
      action: 'pi:call',
      call: { method, args } as PiClientCall,
    })

  return {
    listThreads: (...args) => call('listThreads', args),
    createThread: (...args) => call('createThread', args),
    getThread: (...args) => call('getThread', args),
    sendMessage: (...args) => call('sendMessage', args),
    cancelRun: (...args) => call('cancelRun', args),
    clearQueue: (...args) => call('clearQueue', args),
    getAvailableModels: (...args) => call('getAvailableModels', args),
    setModel: (...args) => call('setModel', args),
    setThinkingLevel: (...args) => call('setThinkingLevel', args),
    renameThread: (...args) => call('renameThread', args),
    archiveThread: (...args) => call('archiveThread', args),
    unarchiveThread: (...args) => call('unarchiveThread', args),
    deleteThread: (...args) => call('deleteThread', args),
    respondToHostUiRequest: (...args) => call('respondToHostUiRequest', args),
    subscribe: (threadId, listener, options) =>
      backend.subscribePi({ threadId, options }, listener),
  }
}
