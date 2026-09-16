import type { PiClient, PiSendMessageInput } from '@assistant-ui/react-pi'
import { createPiHttpClient } from '@assistant-ui/react-pi'
import type { ContextAwarePiClient } from '@/shared/pi/piClient'
import {
  restorePendingContextAttachmentIds,
  takePendingContextAttachmentIds,
} from '../context/pendingContextAttachments'
import { withPendingNewThreadPreferences } from './pendingNewThreadPreferences'

export function createElectronPiClient(baseUrl: string): PiClient {
  const httpClient = createPiHttpClient({ baseUrl })
  const endpoint = baseUrl.replace(/\/+$/, '')
  const attachmentAwareClient: ContextAwarePiClient = {
    ...httpClient,
    async sendMessage(
      threadId: string,
      input: PiSendMessageInput,
      contextAttachmentIds: readonly string[] = [],
    ) {
      const pendingIds = takePendingContextAttachmentIds()
      const attachmentIds = [...new Set([...contextAttachmentIds, ...pendingIds])]
      try {
        if (attachmentIds.length === 0) {
          await httpClient.sendMessage(threadId, input)
          return
        }

        const response = await fetch(
          `${endpoint}/threads/${encodeURIComponent(threadId)}/messages`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ input, contextAttachmentIds: attachmentIds }),
          },
        )
        if (response.ok) return
        const body = await response.text().catch(() => '')
        throw new Error(
          `Pi HTTP request failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
        )
      } catch (error) {
        restorePendingContextAttachmentIds(pendingIds)
        throw error
      }
    },
  }

  return withPendingNewThreadPreferences(attachmentAwareClient)
}

export function createElectronPiIpcClient(): PiClient {
  const ipcClient = window.api.pi
  const attachmentAwareClient: ContextAwarePiClient = {
    ...ipcClient,
    async sendMessage(
      threadId: string,
      input: PiSendMessageInput,
      contextAttachmentIds: readonly string[] = [],
    ) {
      const pendingIds = takePendingContextAttachmentIds()
      const attachmentIds = [...new Set([...contextAttachmentIds, ...pendingIds])]
      try {
        await ipcClient.sendMessage(threadId, input, attachmentIds)
      } catch (error) {
        restorePendingContextAttachmentIds(pendingIds)
        throw error
      }
    },
  }

  return withPendingNewThreadPreferences(attachmentAwareClient)
}
