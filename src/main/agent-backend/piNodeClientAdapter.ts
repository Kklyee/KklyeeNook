import {
  createPiNodeClient,
  type PiClient,
  type PiNodeClientOptions,
} from '@assistant-ui/react-pi/node'

import type { ContextAwarePiClient } from '@/shared/pi/piClient'

let longLivedNodeClient: PiClient | undefined

function getLongLivedNodeClient(options: PiNodeClientOptions): PiClient {
  return (longLivedNodeClient ??= createPiNodeClient(options))
}

/**
 * Keeps the app-owned Pi facade (context, approvals, artifacts and run history)
 * while anchoring the backend to the package's process-long NodeClient seam.
 * The NodeClient is created once per backend process, never per HTTP request.
 */
export function createPiNodeClientAdapter(
  appClient: ContextAwarePiClient,
  options: PiNodeClientOptions,
): ContextAwarePiClient {
  const nodeClient = getLongLivedNodeClient(options)

  return {
    listThreads: (...args) => appClient.listThreads(...args),
    createThread: (...args) => appClient.createThread(...args),
    getThread: (...args) => appClient.getThread(...args),
    sendMessage: (...args) => appClient.sendMessage(...args),
    cancelRun: (...args) => appClient.cancelRun(...args),
    clearQueue: (...args) => appClient.clearQueue(...args),
    getAvailableModels: async (...args) => {
      const appModels = await appClient.getAvailableModels(...args)
      if (appModels.length > 0) return appModels
      try {
        return await nodeClient.getAvailableModels(...args)
      } catch {
        return appModels
      }
    },
    setModel: (...args) => appClient.setModel(...args),
    setThinkingLevel: (...args) => appClient.setThinkingLevel(...args),
    renameThread: (...args) => appClient.renameThread(...args),
    archiveThread: (...args) => appClient.archiveThread(...args),
    unarchiveThread: (...args) => appClient.unarchiveThread(...args),
    deleteThread: (...args) => appClient.deleteThread(...args),
    respondToHostUiRequest: (...args) => appClient.respondToHostUiRequest(...args),
    subscribe: (...args) => appClient.subscribe(...args),
  }
}
