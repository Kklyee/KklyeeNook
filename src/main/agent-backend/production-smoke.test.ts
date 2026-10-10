import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { resolveConfig } from 'electron-vite'
import { build } from 'vite'

const execute = promisify(execFile)

test('production utility-process bootstrap serves authenticated submissions and official run receipts', async () => {
  const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.nook-production-'))
  let calls = 0
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {}
    calls++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: ' + JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Production host accepted.' }, finish_reason: null }] }) + '\n\n')
    response.end('data: ' + JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Model server did not bind')
    const require = createRequire(import.meta.url)
    const options = {
      config: { model: { provider: 'test-provider', modelID: 'test-model', api: 'openai-completions', baseUrl: `http://127.0.0.1:${address.port}/v1` }, tools: { enabled: [] }, compaction: { enabled: false, reserveTokens: 1000, keepRecentTokens: 1000 } },
      apiKeys: { 'test-provider': 'synthetic-key' }, databaseUrl: 'file:' + join(directory, 'business.sqlite'),
      migrationsPath: fileURLToPath(new URL('../../../drizzle', import.meta.url)), sessionDir: join(directory, 'sessions'), allowedOrigins: [],
    }
    const config = await resolveConfig({ build: { outDir: directory }, logLevel: 'silent' }, 'build')
    await build(config.config!.main!)
    const utility = join(directory, 'main', 'agent-backend-entry.mjs')
    const script = `
import { app, utilityProcess } from 'electron'
app.setPath('userData', ${JSON.stringify(directory)})
const options = ${JSON.stringify(options)}
const children = new Set()
const start = () => {
  const child = utilityProcess.fork(${JSON.stringify(utility)}, [], { env: { ...process.env, USERPROFILE: ${JSON.stringify(directory)}, HOME: ${JSON.stringify(directory)} }, stdio: 'pipe' })
  children.add(child)
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let sequence = 0
  const ready = new Promise((resolve, reject) => {
    child.on('message', message => {
      if (message.type === 'failed') reject(new Error(message.message))
      if (message.type === 'ready') resolve(message.info)
      if (message.type === 'response') {
        const receiver = pending.get(message.id)
        pending.delete(message.id)
        message.ok ? receiver?.resolve(message.value) : receiver?.reject(new Error(message.message))
      }
    })
    child.on('exit', () => reject(new Error('Backend exited before ready')))
  })
  const exited = new Promise(resolve => child.on('exit', code => { children.delete(child); resolve(code) }))
  child.on('spawn', () => child.postMessage({ type: 'initialize', options }))
  return {
    child, ready, exited,
    rpc: (action, request = {}) => new Promise((resolve, reject) => {
      const requestId = String(++sequence)
      pending.set(requestId, { resolve, reject })
      child.postMessage({ type: 'request', action, ...request, requestId })
    }),
    close: async () => { child.postMessage({ type: 'shutdown' }); if (await exited !== 0) throw new Error('Backend shutdown failed') },
  }
}
app.whenReady().then(async () => {
    try {
      const first = start()
      const base = (await first.ready).baseUrl
      if (!base.endsWith('/api/agent')) throw new Error('Legacy execution protocol is active')
      const unauthorized = await fetch(new URL('/wrong/api/agent/threads', base))
      if (unauthorized.status !== 404) throw new Error('Missing authentication')
      const forbidden = await fetch(base + '/threads', { headers: { origin: 'https://untrusted.test' } })
      if (forbidden.status !== 403) throw new Error('Missing Origin boundary')
      const duplicate = start()
      await duplicate.ready.then(() => { throw new Error('Duplicate owner started') }, error => { if (!error.message.includes('locked')) throw error })
      if (await duplicate.exited !== 1) throw new Error('Duplicate owner was not rejected')
      const json = async (path, body) => {
        const response = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
        if (!response.ok) throw new Error(await response.text())
        return response.json()
      }
      await json('/threads', { threadId: 'production-thread' })
      await first.rpc('settings:prepare')
      await first.rpc('settings:commit', { config: { ...options.config, model: { provider: 'invalid-provider', modelID: 'invalid-model' } }, apiKeys: {} }).then(() => { throw new Error('Invalid settings accepted') }, error => { if (error.message === 'Invalid settings accepted') throw error })
      await first.rpc('settings:prepare')
      await first.rpc('settings:cancel')
      const input = { type: 'input', content: 'Hello', requestId: 'production-request' }
      const accepted = await json('/threads/production-thread/submissions', input)
      const until = Date.now() + 15000
      let status
      do {
        status = await json('/threads/production-thread/submissions/' + accepted.submissionId)
        if (status.status === 'done') break
        await new Promise(resolve => setTimeout(resolve, 25))
      } while (Date.now() < until)
      if (status.status !== 'done') throw new Error('Submission did not finish')
      const repeated = await json('/threads/production-thread/submissions', input)
      if (repeated.submissionId !== accepted.submissionId) throw new Error('Duplicate admission')
      const snapshot = await json('/threads/production-thread')
      const runs = await first.rpc('agent-run:list', { request: { sessionId: 'production-thread' } })
      const records = await first.rpc('agent-execution-record:list', { request: { runId: runs[0].id } })
      await first.close()
      const restored = start()
      const restoredBase = (await restored.ready).baseUrl
      if (restoredBase === base) throw new Error('Restart reused the authentication endpoint')
      const repeatedAfterRestart = await fetch(restoredBase + '/threads/production-thread/submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }).then(response => response.json())
      if (repeatedAfterRestart.submissionId !== accepted.submissionId) throw new Error('Restart duplicated admission')
      const restoredRuns = await restored.rpc('agent-run:list', { request: { sessionId: 'production-thread' } })
      if (JSON.stringify(restoredRuns) !== JSON.stringify(runs)) throw new Error('Restart changed official run receipts')
      await restored.close()
      process.stdout.write('PRODUCTION_SMOKE=' + JSON.stringify({ snapshot, runs, records }) + '\\n')
      app.exit(0)
    } catch (error) {
      console.error(error)
      for (const child of children) child.kill()
      app.exit(1)
    }
})
`
    const path = join(directory, 'main.mjs')
    await writeFile(path, script)
    await execute(process.execPath, ['--check', path], { windowsHide: true })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const { stdout } = await execute(require('electron'), [path], { env, windowsHide: true, timeout: 45000 })
    const line = stdout.split(/\r?\n/).find((value) => value.startsWith('PRODUCTION_SMOKE='))
    expect(line).toBeDefined()
    const result = JSON.parse(line!.slice('PRODUCTION_SMOKE='.length))
    expect(calls).toBe(1)
    expect(result.runs).toEqual([expect.objectContaining({ status: 'completed', result: 'Production host accepted.' })])
    expect(result.records.map((record) => record.event.type)).toEqual(['agent_started', 'text_delta', 'agent_completed'])
    expect(JSON.stringify(result.snapshot.snapshot.entries)).toContain('Production host accepted.')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
