import { afterEach, expect, test, vi } from 'vitest'
import type { AppendMessage } from '@assistant-ui/react'
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
      url.endsWith('/bots') ? Promise.resolve(response(bots)) : request(url, init),
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
