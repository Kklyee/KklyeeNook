import { afterEach, expect, test, vi } from 'vitest'

import {
  clearPendingContextAttachmentIds,
  rememberPendingContextAttachment,
  takePendingContextAttachmentIds,
} from '../context/pendingContextAttachments'
import { createElectronPiClient, createElectronPiIpcClient } from './electronPiClient'

afterEach(() => {
  clearPendingContextAttachmentIds()
  vi.unstubAllGlobals()
})

test('sends staged context IDs over the HTTP message route', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  rememberPendingContextAttachment('attachment-1')

  const client = createElectronPiClient('http://127.0.0.1:41000/random/api/pi')
  await client.sendMessage('thread / one', { content: 'use this file' })

  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0]?.[0]).toBe(
    'http://127.0.0.1:41000/random/api/pi/threads/thread%20%2F%20one/messages',
  )
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    input: { content: 'use this file' },
    contextAttachmentIds: ['attachment-1'],
  })
  expect(takePendingContextAttachmentIds()).toEqual([])
})

test('restores staged context IDs when the HTTP message request fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async () => new Response('busy', { status: 409 })),
  )
  rememberPendingContextAttachment('attachment-2')

  const client = createElectronPiClient('http://127.0.0.1:41000/random/api/pi')
  await expect(client.sendMessage('thread-1', { content: 'retry me' })).rejects.toThrow(
    'Pi HTTP request failed: 409',
  )
  expect(takePendingContextAttachmentIds()).toEqual(['attachment-2'])
})

test('sends staged context IDs over the temporary IPC transport', async () => {
  const sendMessage = vi.fn(async () => undefined)
  vi.stubGlobal('window', { api: { pi: { sendMessage } } })
  rememberPendingContextAttachment('attachment-3')

  const client = createElectronPiIpcClient()
  await client.sendMessage('thread-1', { content: 'use this file' })

  expect(sendMessage).toHaveBeenCalledWith('thread-1', { content: 'use this file' }, [
    'attachment-3',
  ])
  expect(takePendingContextAttachmentIds()).toEqual([])
})
