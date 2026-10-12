import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BotTask } from '@kklyeenook/shared/bot/grove'
import type { NetworkBotIdentity, RelayEnvelope } from '@kklyeenook/shared/bot/social'
import type { SocialOutboxEntry } from '../../../agent/src/grove/remote-transport'

export async function testHostProcess(
  relayUrl: string,
  token: string,
  name: string,
  answer: string,
) {
  const directory = await mkdtemp(join(tmpdir(), 'grove-host-'))
  let child: ChildProcess | undefined
  let sequence = 0
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const call = <T>(command: string, input?: unknown) =>
    new Promise<T>((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve: (value) => resolve(value as T), reject })
      child!.send({ id, command, input })
    })
  const start = async () => {
    child = spawn(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('./host-runner.ts', import.meta.url))],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true },
    )
    child.on('message', (value) => {
      const message = value as { id: number; value?: unknown; error?: string }
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request?.reject(new Error(message.error))
      else request?.resolve(message.value)
    })
    child.on('exit', () => {
      for (const request of pending.values()) request.reject(new Error('Host process exited'))
      pending.clear()
    })
    await call('init', { relayUrl, token, name, answer, directory })
  }
  const stop = async () => {
    if (!child || child.exitCode !== null) return
    const exited = once(child, 'exit')
    await call('close')
    await exited
    child = undefined
  }
  await start()
  return {
    directory,
    syncNetwork: () => call<void>('sync'),
    network: (enabled: boolean) => call<void>('network', { enabled }),
    identities: () => call<NetworkBotIdentity[]>('identities'),
    tasks: () => call<BotTask[]>('tasks'),
    task: (id: string) => call<BotTask>('task', { id }),
    outbox: () => call<SocialOutboxEntry[]>('outbox'),
    inbox: () => call<{ envelope: RelayEnvelope; processedAt: number | null }[]>('inbox'),
    requestTask: (input: { toBotId: string; instruction: string; operationId: string }) =>
      call<BotTask>('request', input),
    privateContext: () => call<string>('private'),
    requests: () => call<Record<string, any>[]>('requests'),
    setPolicy: (botId: string, messages: boolean, tasks: boolean) =>
      call<void>('policy', { botId, messages, tasks }),
    sendMessage: (input: { toBotId: string; content: string; operationId: string }) =>
      call<unknown>('message', input),
    thread: (id: string) => call<{ workspaceId: string | null }>('thread', { id }),
    snapshot: (id: string) => call<unknown>('snapshot', { id }),
    async restart() {
      await stop()
      await start()
    },
    stop,
    resume: start,
    async close() {
      await stop()
      if (!directory.startsWith(join(tmpdir(), 'grove-host-')))
        throw new Error('Unexpected test directory')
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    },
  }
}
