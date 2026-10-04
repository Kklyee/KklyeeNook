import type { PermissionMode } from '@/shared/approval/permission'
import { notifyWorkspaceChanged } from '../../workspaces/WorkspaceProvider'
import type { PiClient, PiSendMessageInput } from '@assistant-ui/react-pi'
import { createPiHttpClient } from '@assistant-ui/react-pi'
import type { ContextAwarePiClient } from '@/shared/pi/piClient'
import type { PiQueueMutation, PiQueueSnapshot } from '@/shared/pi/piClient'
import {
  restorePendingContextAttachmentIds,
  takePendingContextAttachmentIds,
} from '../context/pendingContextAttachments'

export function createElectronPiClient(
  baseUrl: string,
  getWorkspaceId: () => string | null = () => null,
  getMode: () => PermissionMode | null = () => null,
): PiClient {
  const httpClient = createPiHttpClient({
    baseUrl,
    onStreamError: (error) => console.error('[PiStream] event stream failed:', error),
  })
  const endpoint = baseUrl.replace(/\/+$/, '')
  const attachmentAwareClient: ContextAwarePiClient = {
    ...httpClient,
    updateQueuedMessage: (threadId, input) => updateQueuedMessageAt(endpoint, threadId, input),
    subscribe(threadId, listener, options) {
      return httpClient.subscribe(threadId, listener, options)
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

async function updateQueuedMessageAt(
  endpoint: string,
  threadId: string,
  input: PiQueueMutation,
): Promise<PiQueueSnapshot> {
  const response = await fetch(`${endpoint}/threads/${encodeURIComponent(threadId)}/queue/item`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error('队列已变化或操作失败，请重试')
  return response.json()
}

export async function updateQueuedMessage(
  threadId: string,
  input: PiQueueMutation,
): Promise<PiQueueSnapshot> {
  const status = await window.api.agentBackend.getStatus()
  if (status.state !== 'ready') throw new Error('Agent backend unavailable')
  return updateQueuedMessageAt(status.info.baseUrl.replace(/\/+$/, ''), threadId, input)
}
