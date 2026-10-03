import type { PermissionMode } from '@/shared/approval/permission'
import { notifyWorkspaceChanged } from '../../workspaces/WorkspaceProvider'
import type { PiClient, PiSendMessageInput } from '@assistant-ui/react-pi'
import { createPiHttpClient } from '@assistant-ui/react-pi'
import type { ContextAwarePiClient } from '@/shared/pi/piClient'
import {
  restorePendingContextAttachmentIds,
  takePendingContextAttachmentIds,
} from '../context/pendingContextAttachments'

export function createElectronPiClient(
  baseUrl: string,
  getWorkspaceId: () => string | null = () => null,
  getMode: () => PermissionMode | null = () => null,
): PiClient {
  const httpClient = createPiHttpClient({ baseUrl })
  const endpoint = baseUrl.replace(/\/+$/, '')
  const attachmentAwareClient: ContextAwarePiClient = {
    ...httpClient,
    subscribe(threadId, listener) {
      return httpClient.subscribe(threadId, listener, { includeSnapshot: true })
    },
    async createThread(input) {
      const session = await window.api.conversations.create({
        title: input?.title,
        workspaceId: getWorkspaceId(),
      })
      const mode = getMode()
      if (mode) await window.api.conversations.setPermission(session.id, mode)
      const snapshot = await httpClient.getThread(session.id)
      notifyWorkspaceChanged()
      if (input?.initialMessage)
        await attachmentAwareClient.sendMessage(session.id, input.initialMessage)
      return snapshot
    },
    async renameThread(id, title) {
      await httpClient.renameThread(id, title)
      notifyWorkspaceChanged()
    },
    async deleteThread(id) {
      await httpClient.deleteThread?.(id)
      notifyWorkspaceChanged()
    },
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
          notifyWorkspaceChanged()
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
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new Error(
            `Pi HTTP request failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
          )
        }
      } catch (error) {
        restorePendingContextAttachmentIds(pendingIds)
        throw error
      }
    },
  }

  return attachmentAwareClient
}
