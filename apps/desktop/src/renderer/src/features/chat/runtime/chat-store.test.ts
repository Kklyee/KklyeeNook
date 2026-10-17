import { afterEach, expect, test, vi } from 'vitest'
import type { AppendMessage } from '@assistant-ui/react'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import { emptySnapshot } from '@kklyeenook/agent/runtime/projection'
import { ChatStore } from './chat-store'
import {
  clearPendingContextAttachmentIds,
  rememberPendingContextAttachment,
} from '../context/pendingContextAttachments'
import type { AgentFrame } from '@kklyeenook/shared/agent/chat-protocol'
import { defaultBot, type BotSummary } from '@kklyeenook/shared/bot/bot'
import { botMentionFormatter } from '@kklyeenook/shared/bot/mentions'

vi.mock('../../workspaces/WorkspaceProvider', () => ({ notifyWorkspaceChanged: vi.fn() }))

class Source {
  static instances: Source[] = []
  onmessage?: (event: MessageEvent) => void
  onerror?: () => void
  closed = false
  constructor(readonly url: string) {
    Source.instances.push(this)
  }
  close() {
    this.closed = true
  }
  send(frame: AgentFrame) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent)
  }
}

const stores: ChatStore[] = []
afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose())
  Source.instances = []
  clearPendingContextAttachmentIds()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const metadata = (id: string) => ({ id, title: id, archived: false, createdAt: 1, updatedAt: 1 })
const snapshot = (id: string) => ({
  threadId: id,
  snapshot: emptySnapshot(),
  metadata: metadata(id),
  approvals: [],
  queue: [],
})
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const frame = (threadId: string, sequence = 0, epoch = 'first'): AgentFrame => ({
  type: sequence === 0 ? 'reset' : 'events',
  threadId,
  epoch,
  sequence,
  events: sequence === 0 ? [emptySnapshot()] : [],
  approvals: [],
  queue: [],
})
const message = (text: string): AppendMessage => ({
  role: 'user',
  content: [{ type: 'text', text }],
  parentId: null,
  sourceId: null,
  runConfig: {},
  createdAt: new Date(),
  metadata: { custom: {} },
})

test('steer refreshes a consumed queue item without resubmitting it', async () => {
  let mutations = 0
  let refreshes = 0
  const store = setup(async (url) => {
    if (url.endsWith('/queue/item')) {
      mutations++
      return new Response(JSON.stringify({ error: { code: 'queue_changed', message: 'Queue changed' } }), { status: 409 })
    }
    if (url.endsWith('/threads')) return response([metadata('a')])
    refreshes++
    return response(snapshot('a'))
  })
  await store.switchToThread('a')
  await expect(store.updateQueue({ mode: 'followUp', itemId: '42', expected: ['old'], index: 0, action: 'steer' })).resolves.toBeUndefined()
  expect(mutations).toBe(1)
  expect(refreshes).toBe(2)
})

test('queue deletion and steering update the UI from the mutation receipt without waiting for refresh', async () => {
  const queued: AgentFrame['queue'] = [{ id: 42 as never, mode: 'followUp', content: 'Correction' }]
  const store = setup(async (url, init) => {
    if (url.endsWith('/queue/item')) {
      const input = JSON.parse(String(init?.body))
      return response(input.action === 'steer' ? [{ ...queued[0], mode: 'steer' }] : [])
    }
    if (url.endsWith('/threads')) return response([metadata('a')])
    return response({ ...snapshot('a'), queue: queued })
  })
  await store.switchToThread('a')
  await store.updateQueue({ itemId: '42', mode: 'followUp', expected: ['Correction'], index: 0, action: 'steer' })
  expect(store.getSnapshot().current.messages).toContainEqual(expect.objectContaining({ role: 'user', metadata: { custom: { pendingSteer: true, submissionId: '42' } } }))
  await store.updateQueue({ itemId: '42', mode: 'steer', expected: ['Correction'], index: 0, action: 'remove' })
  expect(store.getSnapshot().extras.queueItems).toEqual([])
  expect(store.getSnapshot().current.messages.some((message) => message.metadata?.custom?.pendingSteer)).toBe(false)
})

test('an older mutation receipt cannot restore a queue consumed by a newer stream frame', async () => {
  let release!: () => void
  const queued: AgentFrame['queue'] = [{ id: 42 as never, mode: 'followUp', content: 'Correction' }]
  const store = setup(async (url) => {
    if (url.endsWith('/queue/item')) return new Promise<Response>((resolve) => { release = () => resolve(response(queued)) })
    if (url.endsWith('/threads')) return response([metadata('a')])
    return response({ ...snapshot('a'), queue: queued })
  })
  await store.switchToThread('a')
  const mutation = store.updateQueue({ itemId: '42', mode: 'followUp', expected: ['Correction'], index: 0, action: 'steer' })
  Source.instances.at(-1)!.send(frame('a', 0, 'newer'))
  release()
  await mutation
  expect(store.getSnapshot().extras.queueItems).toEqual([])
})

function setup(
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>,
  bots: BotSummary[] = [],
) {
  vi.stubGlobal('EventSource', Source)
  const request =
    fetcher ??
    (async (url: string) =>
      response(
        url.endsWith('/threads')
          ? [metadata('a'), metadata('b')]
          : snapshot(url.split('/').at(-1)!),
      ))
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) =>
      url.endsWith('/bots') ? Promise.resolve(response(bots)) : request(url.replace(/\?runs=2$/, ''), init),
    ),
  )
  const store = new ChatStore('http://localhost/secret/api/agent', () => ({}))
  stores.push(store)
  return store
}

test('Composer tokens send structured IDs and ranges while retrying one immutable message', async () => {
  const sent: Record<string, any>[] = []
  let lost = true
  const store = setup(async (url, init) => {
    if (url.endsWith('/submissions')) {
      sent.push(JSON.parse(init!.body as string))
      if (lost) { lost = false; throw new TypeError('lost acknowledgement') }
      return response({ accepted: true })
    }
    return response(url.endsWith('/threads') ? [metadata('a')] : snapshot('a'))
  })
  await store.switchToThread('a')
  const token = botMentionFormatter.serialize({ id: 'stable-coder', label: 'Coder' })
  await expect(store.submit(message(`先看 ${token} 检查代码`))).rejects.toThrow('lost')
  await store.submit(message(`先看 ${token} 检查代码`))
  expect(sent[0]).toEqual(sent[1])
  expect(sent[0].content).toBe('先看 @Coder 检查代码')
  expect(sent[0].botMentions).toEqual([{ botId: 'stable-coder', displayName: 'Coder', start: 3, end: 9 }])
  await store.submit(message('@Coder 普通消息'))
  expect(sent[2].botMentions).toBeUndefined()
})

test('mention navigation returns to the source thread and preserves its unsent draft without submitting', async () => {
  const requests: string[] = []
  const store = setup(async (url) => {
    requests.push(url)
    if (url.endsWith('/main-thread')) return response(metadata('coder-main'))
    return response(url.endsWith('/threads') ? [metadata('source')] : snapshot(url.split('/').at(-1)!))
  })
  await store.switchToThread('source')
  await store.navigateMention('coder', 'Unsent draft')
  expect(store.getSnapshot().selectedThreadId).toBe('coder-main')
  expect(store.getSnapshot().mentionReturn).toEqual({ threadId: 'source', text: 'Unsent draft' })
  expect(await store.returnFromMention()).toBe('Unsent draft')
  expect(store.getSnapshot().selectedThreadId).toBe('source')
  expect(requests.some((url) => url.endsWith('/submissions') || url.endsWith('/grove/tasks'))).toBe(false)
})

test('caches external-store snapshots and rejects stale thread loads and stale connections', async () => {
  let finish!: (value: Response) => void
  const store = setup(async (url) =>
    url.endsWith('/threads')
      ? response([metadata('a'), metadata('b')])
      : url.endsWith('/a')
        ? new Promise((resolve) => {
            finish = resolve
          })
        : response(snapshot('b')),
  )
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

test('keeps new workspace threads temporary until the first message and reuses creation retries', async () => {
  const creations: string[] = []
  const known = [metadata('a')]
  const store = setup(async (url, init) => {
    if (url.endsWith('/submissions')) return response({ accepted: true })
    if (url.endsWith('/threads') && init?.method === 'POST') {
      const id = JSON.parse(String(init.body)).threadId
      creations.push(id)
      if (creations.length === 1) throw new Error('Creation acknowledgement lost')
      known.push(metadata(id))
      return response(metadata(id))
    }
    return response(url.endsWith('/threads') ? known : snapshot(url.split('/').at(-1)!))
  })
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  const abandoned = await store.createThread({ botId: 'coder', workspaceId: 'workspace' })
  const draft = await store.createThread({ botId: 'coder', workspaceId: 'workspace' })
  expect(draft).not.toBe(abandoned)
  expect(creations).toEqual([])
  expect(store.getSnapshot().selectedThreadId).toBeUndefined()
  expect(store.getSnapshot().current.metadata).toMatchObject({ id: draft, workspaceId: 'workspace' })
  expect(store.getSnapshot().threadList.threads).toHaveLength(1)
  await store.reloadThreads()
  expect(store.getSnapshot().current.metadata?.id).toBe(draft)
  await expect(store.submit(message('hello'))).rejects.toThrow('Creation acknowledgement lost')
  expect(store.getSnapshot().current.error).toBe('Creation acknowledgement lost')
  await store.submit(message('hello'))
  expect(store.getSnapshot().current.error).toBeUndefined()
  expect(creations[1]).toBe(creations[0])
  expect(creations[1]).toBe(draft)
  expect(store.getSnapshot().threadList.threads?.some((thread) => thread.id === draft)).toBe(true)
  await store.createThread()
  await store.submit(message('next'))
  expect(creations[2]).not.toBe(creations[0])
  expect(store.getSnapshot().selectedThreadId).toBe(creations[2])
})

test('discards unsent drafts on navigation and preserves workspace and model choices on first send', async () => {
  const creations: Record<string, unknown>[] = []
  const known = [metadata('a')]
  const store = setup(async (url, init) => {
    if (url.endsWith('/submissions')) return response({ accepted: true })
    if (url.endsWith('/threads') && init?.method === 'POST') {
      const input = JSON.parse(String(init.body))
      creations.push(input)
      const created = { ...metadata(input.threadId), ...input }
      known.push(created)
      return response(created)
    }
    return response(url.endsWith('/threads') ? known : snapshot(url.split('/').at(-1)!))
  })
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  await store.createThread({ botId: 'coder', workspaceId: 'workspace' })
  await store.switchToThread('a')
  expect(creations).toEqual([])
  expect(store.getSnapshot().threads.map((thread) => thread.id)).toEqual(['a'])
  await store.createThread({ botId: 'coder', workspaceId: 'workspace' })
  await store.setWorkspace(null)
  await store.setModel({ provider: 'test', modelId: 'model' })
  await store.setThinkingLevel('high')
  expect(creations).toEqual([])
  await store.refresh()
  expect(store.getSnapshot().current.metadata?.workspaceId).toBeNull()
  await store.submit(message('hello'))
  expect(creations).toEqual([expect.objectContaining({ botId: 'coder', workspaceId: null, model: { provider: 'test', modelId: 'model' }, thinkingLevel: 'high' })])
})

test('Bot-first entry restores one main Thread and rejects late responses from another Bot', async () => {
  const bots: BotSummary[] = ['xiaoya', 'coder', 'slow'].map((id) => ({
    ...defaultBot(id, id, id === 'coder'),
    state: 'idle',
  }))
  const threads = bots.map((bot) => ({ ...metadata(bot.mainThreadId), botId: bot.id }))
  let slow!: (value: Response) => void
  const store = setup(async (url) => {
    if (url.includes('/grove/mention-targets?')) return response([])
    if (url.endsWith('/threads')) return response(threads)
    if (url.endsWith('/main-thread')) {
      const id = url.split('/').at(-2)!
      if (id === 'slow')
        return new Promise((resolve) => {
          slow = resolve
        })
      return response(threads.find((thread) => thread.botId === id))
    }
    const id = decodeURIComponent(url.split('/').at(-1)!)
    return response({ ...snapshot(id), metadata: threads.find((thread) => thread.id === id) })
  }, bots)
  await vi.waitFor(() => expect(store.getSnapshot().selectedThreadId).toBe(bots[0].mainThreadId))
  const old = Source.instances.at(-1)!
  const pending = store.selectBot('slow')
  expect(old.closed).toBe(true)
  expect(store.getSnapshot().current.metadata).toBeUndefined()
  await store.selectBot('coder')
  slow(response(threads[2]))
  await pending
  expect(store.getSnapshot().selectedBotId).toBe('coder')
  expect(store.getSnapshot().selectedThreadId).toBe(bots[1].mainThreadId)
  await store.selectBot('xiaoya')
  expect(store.getSnapshot().selectedThreadId).toBe(bots[0].mainThreadId)
  expect(store.getSnapshot().threads).toHaveLength(3)
  await store.createThread({ botId: 'coder', workspaceId: 'workspace' })
  expect(await store.mentionTargets()).toEqual([])
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringContaining(`threadId=${encodeURIComponent(bots[1].mainThreadId)}`),
    expect.anything(),
  )
  await store.selectBot('xiaoya')
  expect(store.getSnapshot().selectedThreadId).toBe(bots[0].mainThreadId)
  expect(store.getSnapshot().threads).toHaveLength(3)
})

test('restarts after StrictMode cleanup and keeps Bot creation and main conversations usable', async () => {
  const bot = { ...defaultBot('xiaoya', '小芽'), state: 'idle' as const }
  const main = { ...metadata(bot.mainThreadId), botId: bot.id }
  const created = { ...defaultBot('custom', 'Scout'), state: 'idle' as const }
  const store = setup(
    async (url) => {
      if (url.endsWith('/threads')) return response([main])
      if (url.endsWith('/main-thread'))
        return response({
          ...main,
          id: url.includes('/custom/') ? created.mainThreadId : main.id,
          botId: url.includes('/custom/') ? created.id : bot.id,
        })
      return response(snapshot(url.split('/').at(-1)!))
    },
    [bot],
  )
  store.dispose()
  store.start()
  await vi.waitFor(() => expect(store.getSnapshot().selectedThreadId).toBe(main.id))
  expect(store.getSnapshot().bots.map((item) => item.id)).toEqual(['xiaoya'])
  store.dispose()
  store.start()
  await vi.waitFor(() => expect(Source.instances.at(-1)?.closed).toBe(false))
  await store.selectBot('custom')
  expect(store.getSnapshot().selectedThreadId).toBe(created.mainThreadId)
  expect(store.getSnapshot().current.loading).toBe(false)
})


test('deduplicates older page loads and keeps them across stream resets', async () => {
  const entries = [1, 2, 3, 4].map((id) => ({ id, conversationId: 1, kind: 'pi.user', model: [{ role: 'user', content: String(id), timestamp: id }] }))
  let pages = 0
  let finish!: () => void
  const store = setup(async (url) => {
    if (url.endsWith('/threads')) return response([metadata('a'), metadata('b')])
    if (url.includes('/history?before=3')) {
      pages++
      await new Promise<void>((resolve) => { finish = resolve })
      return response({ entries: entries.slice(0, 2), sinceEntry: 1, hasMore: false })
    }
    return response({ ...snapshot('a'), snapshot: { ...emptySnapshot(), entries: entries.slice(2) }, history: { sinceEntry: 3, hasMore: true } })
  })
  await store.switchToThread('a')
  const ids = store.getSnapshot().current.messages.map((message) => message.id)
  const load = store.loadOlder()
  await store.loadOlder()
  expect(pages).toBe(1)
  finish()
  await load
  expect(store.getSnapshot().current.messages.slice(-2).map((message) => message.id)).toEqual(ids)
  Source.instances.at(-1)!.send({ ...frame('a'), events: [{ ...emptySnapshot(), entries: entries.slice(2) } as never] })
  expect(store.getSnapshot().current.messages).toHaveLength(4)
  expect(store.getSnapshot().extras.history.hasMore).toBe(false)
})

test('ignores older page responses after switching conversations', async () => {
  let finish!: () => void
  const store = setup(async (url) => {
    if (url.endsWith('/threads')) return response([metadata('a'), metadata('b')])
    if (url.includes('/history?')) {
      await new Promise<void>((resolve) => { finish = resolve })
      return response({ entries: [], sinceEntry: 1, hasMore: false })
    }
    return response({ ...snapshot('a'), history: { sinceEntry: 3, hasMore: true } })
  })
  await store.switchToThread('a')
  const load = store.loadOlder()
  await store.switchToThread('b')
  finish()
  await load
  expect(store.getSnapshot().selectedThreadId).toBe('b')
  expect(store.getSnapshot().extras.history.sinceEntry).toBe(3)
})


test('collaboration cards share one poll and release it after the last subscriber', async () => {
  const store = new ChatStore('http://localhost/secret/api/agent', () => ({}), false)
  stores.push(store)
  let requests = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    requests++
    return response({ messages: [], tasks: [] })
  }))
  vi.useFakeTimers()
  const first = vi.fn()
  const second = vi.fn()
  const stopFirst = store.subscribeGrove(first)
  const stopSecond = store.subscribeGrove(second)
  await vi.advanceTimersByTimeAsync(0)
  expect(requests).toBe(1)
  await vi.advanceTimersByTimeAsync(2000)
  expect(requests).toBe(2)
  stopFirst()
  stopSecond()
  await vi.advanceTimersByTimeAsync(2000)
  expect(requests).toBe(2)
})


test('reloads the previously viewed history range before exposing a revisited conversation', async () => {
  const entries = [1, 2, 3, 4].map((id) => ({ id, conversationId: 1, kind: 'pi.user', model: [{ role: 'user', content: String(id), timestamp: id }] }))
  let pages = 0
  const store = setup(async (url) => {
    if (url.endsWith('/threads')) return response([metadata('a'), metadata('b')])
    if (url.includes('/history?before=3')) {
      pages++
      return response({ entries: entries.slice(0, 2), sinceEntry: 1, hasMore: false })
    }
    if (url.includes('/threads/b')) return response(snapshot('b'))
    return response({ ...snapshot('a'), snapshot: { ...emptySnapshot(), entries: entries.slice(2) }, history: { sinceEntry: 3, hasMore: true } })
  })
  await store.switchToThread('a')
  await store.loadOlder()
  const ids = store.getSnapshot().current.messages.map((message) => message.id)
  await store.switchToThread('b')
  const observed: number[] = []
  const unsubscribe = store.subscribe(() => {
    const value = store.getSnapshot()
    if (value.selectedThreadId === 'a' && !value.current.loading) observed.push(value.current.messages.length)
  })
  await store.switchToThread('a')
  unsubscribe()
  expect(pages).toBe(2)
  expect(observed).not.toContain(2)
  expect(store.getSnapshot().current.messages.map((message) => message.id)).toEqual(ids)
})


test('keeps the original history start when a newer latest window requires an overlapping older page', async () => {
  const entries = [1, 2, 3, 4, 5, 6].map((id) => ({ id, conversationId: 1, kind: 'pi.user', model: [{ role: 'user', content: String(id), timestamp: id }] }))
  let newer = false
  const store = setup(async (url) => {
    if (url.endsWith('/threads')) return response([metadata('a'), metadata('b')])
    if (url.includes('/threads/b')) return response(snapshot('b'))
    if (url.includes('/history?before=5')) return response({ entries: entries.slice(0, 4), sinceEntry: 1, hasMore: false })
    return response({ ...snapshot('a'), snapshot: { ...emptySnapshot(), entries: newer ? entries.slice(4) : entries.slice(2, 4) }, history: { sinceEntry: newer ? 5 : 3, hasMore: true } })
  })
  await store.switchToThread('a')
  const ids = store.getSnapshot().current.messages.map((message) => message.id)
  await store.switchToThread('b')
  newer = true
  await store.switchToThread('a')
  expect(store.getSnapshot().current.messages.slice(0, 2).map((message) => message.id)).toEqual(ids)
  expect(store.getSnapshot().current.messages).toHaveLength(4)
  expect(store.getSnapshot().extras.history.sinceEntry).toBe(3)
})


test('cached conversations remain interactive during refresh and ignore a late stale response', async () => {
  let reads = 0
  let finish!: (response: Response) => void
  const requests: Array<{ url: string; body: any }> = []
  const value = (text: string) => ({ ...snapshot('a'), metadata: { ...metadata('a'), botId: 'coder' }, queue: [{ id: 42, mode: 'followUp', content: 'Queued' }], snapshot: { ...emptySnapshot(), entries: [{ id: 1, conversationId: 1, kind: 'pi.assistant', model: [{ ...fauxAssistantMessage(text), timestamp: 1 }] }] } })
  const store = setup(async (url, init) => {
    if (url.endsWith('/threads')) return response([metadata('a'), metadata('b')])
    if (init?.method === 'POST') {
      requests.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      return response(url.endsWith('/queue/item') ? [] : { ok: true })
    }
    if (url.endsWith('/threads/a')) {
      if (++reads === 1) return response(value('Cached reply'))
      return new Promise((resolve) => { finish = resolve })
    }
    return response(snapshot('b'))
  })
  await store.switchToThread('a')
  await store.switchToThread('b')
  const refresh = store.switchToThread('a')
  expect(store.getSnapshot().current.loading).toBe(false)
  expect(JSON.stringify(store.getSnapshot().current.messages)).toContain('Cached reply')
  await store.submit(message('New message'))
  await store.cancel()
  await store.updateQueue({ mode: 'followUp', itemId: '42', expected: ['Queued'], index: 0, action: 'remove' })
  expect(requests.filter((request) => request.url.endsWith('/submissions'))).toHaveLength(1)
  expect(requests.find((request) => request.url.endsWith('/submissions'))?.body.whenBusy).toBe('followUp')
  expect(requests.some((request) => request.url.endsWith('/cancel'))).toBe(true)
  expect(requests.some((request) => request.url.endsWith('/queue/item'))).toBe(true)
  const live = value('Live reply')
  Source.instances.at(-1)!.send({ ...frame('a', 1, 'fresh'), type: 'reset', queue: [], events: [live.snapshot as never] })
  finish(response(value('Old refresh')))
  await refresh
  expect(JSON.stringify(store.getSnapshot().current.messages)).toContain('Live reply')
  expect(JSON.stringify(store.getSnapshot().current.messages)).not.toContain('Old refresh')
  expect(store.getSnapshot().extras.queueItems).toEqual([])
})

test('a background read cannot undo a successful queue mutation before its stream event arrives', async () => {
  let reads = 0
  let finish!: (response: Response) => void
  const value = { ...snapshot('a'), queue: [{ id: 42, mode: 'followUp', content: 'Queued' }] }
  const store = setup(async (url) => {
    if (url.endsWith('/threads')) return response([metadata('a'), metadata('b')])
    if (url.endsWith('/queue/item')) return response([])
    if (url.endsWith('/threads/a')) {
      if (++reads === 1) return response(value)
      return new Promise((resolve) => { finish = resolve })
    }
    return response(snapshot('b'))
  })
  await store.switchToThread('a')
  await store.switchToThread('b')
  const refresh = store.switchToThread('a')
  await store.updateQueue({ mode: 'followUp', itemId: '42', expected: ['Queued'], index: 0, action: 'remove' })
  finish(response(value))
  await refresh
  expect(store.getSnapshot().extras.queueItems).toEqual([])
  expect(store.getSnapshot().current.loading).toBe(false)
})


test('first send promotes the draft without loading history or hiding the composer', async () => {
  let historyRequests = 0
  const store = setup(async (url, init) => {
    if (url.endsWith('/threads') && init?.method === 'POST')
      return response(metadata(JSON.parse(String(init.body)).threadId))
    if (url.endsWith('/threads')) return response([])
    if (url.endsWith('/submissions')) return response({ accepted: true })
    historyRequests++
    return response(snapshot(url.split('/').at(-1)!))
  })
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  const id = await store.createThread()
  const states: { loading: boolean; creating: boolean; selected?: string }[] = []
  const unsubscribe = store.subscribe(() => {
    const state = store.getSnapshot()
    states.push({ loading: state.current.loading, creating: state.sending.creating, selected: state.selectedThreadId })
  })
  await store.submit(message('First message'))
  unsubscribe()
  expect(historyRequests).toBe(0)
  expect(states.every(state => !state.loading)).toBe(true)
  expect(states.some(state => state.selected === id && state.creating)).toBe(true)
  expect(Source.instances.at(-1)?.url).toContain(`/threads/${id}/events`)
})

test('a new conversation shows the submitted message before the backend acknowledges it', async () => {
  let releaseCreation!: () => void
  let releaseSubmission!: () => void
  const store = setup(async (url, init) => {
    if (url.endsWith('/threads') && init?.method === 'POST')
      return new Promise<Response>((resolve) => {
        releaseCreation = () => resolve(response(metadata(JSON.parse(String(init.body)).threadId)))
      })
    if (url.endsWith('/threads')) return response([])
    if (url.endsWith('/submissions'))
      return new Promise<Response>((resolve) => {
        releaseSubmission = () => resolve(response({ accepted: true }))
      })
    return response(snapshot(url.split('/').at(-1)!))
  })
  await vi.waitFor(() => expect(store.getSnapshot().threadList.isLoading).toBe(false))
  const id = await store.createThread()
  const submission = store.submit(message('First message'))
  expect(store.getSnapshot().current.messages).toContainEqual(
    expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'First message' }] }),
  )
  releaseCreation()
  await vi.waitFor(() => expect(store.getSnapshot().selectedThreadId).toBe(id))
  expect(store.getSnapshot().current.messages).toContainEqual(
    expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'First message' }] }),
  )
  releaseSubmission()
  await submission
})

test('the optimistic message yields to the stored message once the stream catches up', async () => {
  const store = setup(async (url) => {
    if (url.endsWith('/submissions')) return response({ accepted: true })
    if (url.endsWith('/threads')) return response([metadata('a')])
    return response(snapshot('a'))
  })
  await store.switchToThread('a')
  await store.submit(message('Hello'))
  expect(store.getSnapshot().current.messages).toContainEqual(
    expect.objectContaining({ id: expect.stringContaining('pending-input'), role: 'user' }),
  )
  const stored = emptySnapshot()
  stored.entries = [
    {
      id: 1 as never,
      conversationId: 1 as never,
      kind: 'pi.user',
      data: {},
      model: [{ role: 'user', content: 'Hello', timestamp: 1 }],
    } as never,
  ]
  Source.instances.at(-1)!.send({ type: 'reset', threadId: 'a', epoch: 'live', sequence: 0, events: [stored], approvals: [], queue: [] })
  expect(store.getSnapshot().current.messages).toHaveLength(1)
  expect(store.getSnapshot().current.messages[0].id).toBe('durable-msg:1:1:user')
})
