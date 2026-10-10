import { afterEach, expect, test, vi } from 'vitest'
import type { AppendMessage } from '@assistant-ui/react'
import { emptySnapshot } from '@/main/agent/projection'
import { ChatStore } from './chat-store'
import { clearPendingContextAttachmentIds, rememberPendingContextAttachment } from '../context/pendingContextAttachments'
import type { AgentFrame } from '@/shared/agent/chat-protocol'

vi.mock('../../workspaces/WorkspaceProvider', () => ({ notifyWorkspaceChanged: vi.fn() }))

class Source {
  static instances: Source[] = []
  onmessage?: (event: MessageEvent) => void
  onerror?: () => void
  closed = false
  constructor(readonly url: string) { Source.instances.push(this) }
  close() { this.closed = true }
  send(frame: AgentFrame) { this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent) }
}

const stores: ChatStore[] = []
afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose())
  Source.instances = []
  clearPendingContextAttachmentIds()
  vi.unstubAllGlobals()
})

const metadata = (id: string) => ({ id, title: id, archived: false, createdAt: 1, updatedAt: 1 })
const snapshot = (id: string) => ({ threadId: id, snapshot: emptySnapshot(), metadata: metadata(id), approvals: [], queue: [] })
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const frame = (threadId: string, sequence = 0, epoch = 'first'): AgentFrame => ({ type: sequence === 0 ? 'reset' : 'events', threadId, epoch, sequence, events: sequence === 0 ? [emptySnapshot()] : [], approvals: [], queue: [] })
const message = (text: string): AppendMessage => ({ role: 'user', content: [{ type: 'text', text }], parentId: null, sourceId: null, runConfig: {}, createdAt: new Date(), metadata: { custom: {} } })

function setup(fetcher?: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('EventSource', Source)
  vi.stubGlobal('fetch', vi.fn(fetcher ?? (async (url: string) => response(url.endsWith('/threads') ? [metadata('a'), metadata('b')] : snapshot(url.split('/').at(-1)!)))))
  const store = new ChatStore('http://localhost/secret/api/agent', () => ({}))
  stores.push(store)
  return store
}

test('caches external-store snapshots and rejects stale thread loads and stale connections', async () => {
  let finish!: (value: Response) => void
  const store = setup(async (url) => url.endsWith('/threads') ? response([metadata('a'), metadata('b')]) : url.endsWith('/a') ? new Promise((resolve) => { finish = resolve }) : response(snapshot('b')))
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  expect(store.getSnapshot()).toBe(store.getSnapshot())
  const first = store.switchToThread('a')
  await store.switchToThread('b')
  finish(response(snapshot('a')))
  await first
  expect(store.getSnapshot().selectedThreadId).toBe('b')
  expect(store.getSnapshot().current.metadata?.id).toBe('b')
  const old = Source.instances.at(-1)!
  await store.refresh()
  const current = store.getSnapshot()
  old.send(frame('b', 0, 'stale'))
  expect(store.getSnapshot()).toBe(current)
})

test('recovers gaps through a new official reset and ignores duplicate and wrong-thread frames', async () => {
  const store = setup()
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  await store.switchToThread('a')
  const source = Source.instances.at(-1)!
  source.send(frame('a'))
  const current = store.getSnapshot()
  source.send(frame('a'))
  source.send(frame('b', 1))
  expect(store.getSnapshot()).toBe(current)
  source.send(frame('a', 2))
  expect(source.closed).toBe(true)
  expect(store.getSnapshot().current.error).toContain('Reconnecting')
  Source.instances.at(-1)!.send(frame('a', 0, 'reconnected'))
  expect(store.getSnapshot().current.error).toBeUndefined()
})

test('reuses immutable admission identity and attachments after a lost acknowledgement', async () => {
  const bodies: Record<string, unknown>[] = []
  const store = setup(async (url, init) => {
    if (url.endsWith('/submissions')) {
      bodies.push(JSON.parse(String(init?.body)))
      if (bodies.length === 1) throw new Error('Acknowledgement lost')
      return response({ accepted: true })
    }
    return response(url.endsWith('/threads') ? [metadata('a')] : snapshot('a'))
  })
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  await store.switchToThread('a')
  rememberPendingContextAttachment('attachment')
  await expect(store.submit(message('Same intent'))).rejects.toThrow('Acknowledgement lost')
  await store.submit(message('Same intent'), 'followUp')
  expect(bodies[1]).toEqual(bodies[0])
  expect(bodies[1].contextAttachmentIds).toEqual(['attachment'])
  await store.submit(message('New intent'))
  expect(bodies[2].requestId).not.toBe(bodies[0].requestId)
})

test('renders history as inert data without opening an execution stream', async () => {
  const store = setup(async (url) => response(url.endsWith('/threads') ? [metadata('a')] : {
    ...snapshot('a'), historical: true,
    history: [{ id: 'old', role: 'assistant', kind: 'message', createdAt: 1, payload: { message: { role: 'assistant', content: [{ type: 'toolCall', id: 'old-call', name: 'write', arguments: { path: 'old' } }] } } }],
  }))
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  await store.switchToThread('a')
  expect(store.getSnapshot().current.disabled).toBe(true)
  expect(Source.instances).toHaveLength(0)
  expect(store.getSnapshot().current.messages[0].content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('未重放') })])
})

test('allows a fresh delivery mode after a definitive busy rejection and retains attachments', async () => {
  const bodies: Record<string, unknown>[] = []
  const store = setup(async (url, init) => {
    if (url.endsWith('/submissions')) {
      bodies.push(JSON.parse(String(init?.body)))
      if (bodies.length === 1) return new Response('Busy', { status: 409 })
      return response({ accepted: true })
    }
    return response(url.endsWith('/threads') ? [metadata('a')] : snapshot('a'))
  })
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  await store.switchToThread('a')
  rememberPendingContextAttachment('attachment')
  await expect(store.submit(message('Same intent'), 'reject')).rejects.toThrow('409')
  await store.submit(message('Same intent'), 'steer')
  expect(bodies[1].requestId).not.toBe(bodies[0].requestId)
  expect(bodies[1]).toMatchObject({ whenBusy: 'steer', contextAttachmentIds: ['attachment'] })
})

test('reuses creation and historical continuation targets after acknowledgement loss', async () => {
  const creations: string[] = []
  const continuations: string[] = []
  const known = [metadata('a')]
  const store = setup(async (url, init) => {
    if (url.endsWith('/threads') && init?.method === 'POST') {
      const id = JSON.parse(String(init.body)).threadId
      creations.push(id)
      if (creations.length === 1) throw new Error('Creation acknowledgement lost')
      known.push(metadata(id))
      return response(metadata(id))
    }
    if (url.endsWith('/continue')) {
      const id = JSON.parse(String(init?.body)).threadId
      continuations.push(id)
      if (continuations.length === 1) throw new Error('Continuation acknowledgement lost')
      known.push(metadata(id))
      return response(metadata(id))
    }
    return response(url.endsWith('/threads') ? known : snapshot(url.split('/').at(-1)!))
  })
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  await expect(store.createThread()).rejects.toThrow('Creation acknowledgement lost')
  await store.createThread()
  expect(creations[1]).toBe(creations[0])
  await store.switchToThread('a')
  await expect(store.continueThread()).rejects.toThrow('Continuation acknowledgement lost')
  await store.continueThread()
  expect(continuations[1]).toBe(continuations[0])
  expect(store.getSnapshot().selectedThreadId).toBe(continuations[0])
})
