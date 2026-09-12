import type { PiClient } from '@assistant-ui/react-pi'
import type { ContextAwarePiClient } from '@/shared/pi/piIpc'
import {
  restorePendingContextAttachmentIds,
  takePendingContextAttachmentIds,
} from '../context/pendingContextAttachments'
import { withPendingNewThreadPreferences } from './pendingNewThreadPreferences'

const contextAwarePiClient = window.api.pi as ContextAwarePiClient

const attachmentAwarePiClient: PiClient = {
  ...contextAwarePiClient,
  async sendMessage(threadId, input) {
    const contextAttachmentIds = takePendingContextAttachmentIds()
    try {
      await contextAwarePiClient.sendMessage(threadId, input, contextAttachmentIds)
    } catch (error) {
      restorePendingContextAttachmentIds(contextAttachmentIds)
      throw error
    }
  },
}

export const electronPiClient = withPendingNewThreadPreferences(attachmentAwarePiClient)
