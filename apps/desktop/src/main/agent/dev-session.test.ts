import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const { beginRemoteDevSession } = await import(
  pathToFileURL(resolve('apps/desktop/scripts/remote-dev-session.mjs')).href
)
let directory: string
let guardian: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nook-dev-session-'))
  guardian = join(directory, 'kklyeenook', 'remote-supervisor')
  vi.stubEnv('APPDATA', directory)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

async function state(value: object) {
  await mkdir(guardian, { recursive: true })
  await writeFile(join(guardian, 'status.json'), '\uFEFF' + JSON.stringify(value))
}

test('development without a configured supervisor does not create a lease', async () => {
  const release = await beginRemoteDevSession(process.cwd())
  await release()
  await expect(readFile(join(guardian, 'dev-session.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
})

test.runIf(process.platform === 'win32')(
  'handover preserves unrelated processes and releases only its own lease',
  async () => {
    await state({ supportsDevSession: true, appPid: process.pid })
    const release = await beginRemoteDevSession(process.cwd())
    expect(JSON.parse(await readFile(join(guardian, 'dev-session.json'), 'utf8')).pid).toBe(
      process.pid,
    )
    expect(() => process.kill(process.pid, 0)).not.toThrow()
    await writeFile(join(guardian, 'dev-session.json'), JSON.stringify({ pid: process.ppid }))
    await release()
    expect(JSON.parse(await readFile(join(guardian, 'dev-session.json'), 'utf8')).pid).toBe(
      process.ppid,
    )
  },
)

test.runIf(process.platform === 'win32')(
  'rejects an existing live development session and an incompatible supervisor',
  async () => {
    await state({ supportsDevSession: false })
    await expect(beginRemoteDevSession(process.cwd())).rejects.toThrow('must be updated or stopped')
    await state({ supportsDevSession: true })
    await writeFile(join(guardian, 'dev-session.json'), JSON.stringify({ pid: process.ppid }))
    await expect(beginRemoteDevSession(process.cwd())).rejects.toThrow('already running')
    expect(JSON.parse(await readFile(join(guardian, 'dev-session.json'), 'utf8')).pid).toBe(
      process.ppid,
    )
  },
)

test.runIf(process.platform === 'win32')(
  'replaces a stale lease and removes it on normal exit',
  async () => {
    await state({ supportsDevSession: true })
    await writeFile(join(guardian, 'dev-session.json'), JSON.stringify({ pid: 2147483647 }))
    const release = await beginRemoteDevSession(process.cwd())
    await release()
    await expect(readFile(join(guardian, 'dev-session.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  },
)
