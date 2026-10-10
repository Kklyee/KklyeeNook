import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { resolveConfig } from 'electron-vite'
import { build } from 'vite'

const execute = promisify(execFile)

test.each(['lifecycle', 'approval-crash', 'cancel-crash', 'unsafe-crash', 'delegation-crash', 'delegation-cancel-crash'] as const)('production utility-process bootstrap and recovery: %s', async (scenario) => {
  const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.nook-production-'))
  const data = await mkdtemp(join(tmpdir(), 'nook-production-data-'))
  let calls = 0
  const modelRequests: any[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    modelRequests.push(body)
    calls++
    const user = JSON.stringify(body.messages.filter((message: { role: string; content?: unknown }) => message.role === 'user').at(-1)?.content)
    const tool = !body.messages.some((message: { role: string }) => message.role === 'tool') && (user.includes('approval-effect') || user.includes('unsafe-effect') || user.includes('delegation-effect'))
    const args = user.includes('unsafe-effect')
      ? { command: process.platform === 'win32' ? "Add-Content -LiteralPath 'effect.txt' -Value 'once'; Start-Sleep -Seconds 30" : "printf 'once\\n' >> effect.txt; sleep 30" }
      : { path: /child-([0-2])/.test(user) ? `child-${/child-([0-2])/.exec(user)![1]}.txt` : 'effect.txt', content: 'once' }
    const requested = user.includes('delegation-effect')
      ? [0, 1, 2].map(index => ({ name: 'delegate_task', id: `delegate-${index}`, args: { task: `approval-effect child-${index}`, context: 'explicit context only' } }))
      : [{ name: user.includes('unsafe-effect') ? 'bash' : 'write', id: 'effect-call', args }]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: ' + JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: tool ? { role: 'assistant', tool_calls: requested.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { role: 'assistant', content: 'Production host accepted.' }, finish_reason: null }] }) + '\n\n')
    response.end('data: ' + JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Model server did not bind')
    const require = createRequire(import.meta.url)
    const options = {
      config: { model: { provider: 'test-provider', modelID: 'test-model', api: 'openai-completions', baseUrl: `http://127.0.0.1:${address.port}/v1` }, tools: { enabled: scenario === 'lifecycle' ? [] : ['write', 'bash', ...(scenario.startsWith('delegation') ? ['delegate_task'] : [])] }, compaction: { enabled: false, reserveTokens: 1000, keepRecentTokens: 1000 } },
      apiKeys: { 'test-provider': 'synthetic-key' }, databaseUrl: 'file:' + join(data, 'business.sqlite'),
      migrationsPath: fileURLToPath(new URL('../../../drizzle', import.meta.url)), sessionDir: join(data, 'sessions'), allowedOrigins: [],
    }
    const config = await resolveConfig({ build: { outDir: directory }, logLevel: 'silent' }, 'build', 'production')
    await build(config.config!.main!)
    await mkdir(join(data, 'workspace'))
    if (process.platform === 'win32') await cp(join(process.cwd(), 'resources', 'sandbox'), join(directory, 'resources', 'sandbox'), { recursive: true })
    const utility = join(directory, 'main', 'agent-backend-entry.mjs')
    const script = `
import { app, utilityProcess } from 'electron'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
app.setPath('userData', ${JSON.stringify(data)})
const options = ${JSON.stringify(options)}
const scenario = ${JSON.stringify(scenario)}
const children = new Set()
const start = () => {
  const child = utilityProcess.fork(${JSON.stringify(utility)}, [], { env: { ...process.env, USERPROFILE: ${JSON.stringify(data)}, HOME: ${JSON.stringify(data)} }, stdio: 'pipe' })
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
      let base = (await first.ready).baseUrl
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
      let crash
      if (scenario !== 'lifecycle') {
        const delegated = scenario.startsWith('delegation')
        const cancelled = scenario === 'cancel-crash' || scenario === 'delegation-cancel-crash'
        base = restoredBase
        const workspace = await restored.rpc('workspace:attach', { path: ${JSON.stringify(join(data, 'workspace'))} })
        await json('/threads', { threadId: 'crash-thread', workspaceId: workspace.workspace.id, permissionMode: scenario === 'unsafe-crash' ? 'workspace-write' : 'read-only' })
        const request = { type: 'input', content: scenario === 'unsafe-crash' ? 'unsafe-effect' : delegated ? 'root-secret delegation-effect' : 'approval-effect', requestId: 'crash-request' }
        const admitted = await json('/threads/crash-thread/submissions', request)
        const poll = async (read, check) => {
          const until = Date.now() + 15000
          while (Date.now() < until) {
            const value = await read()
            if (check(value)) return value
            await new Promise(resolve => setTimeout(resolve, 25))
          }
          throw new Error('Recovery condition timed out')
        }
        const effect = ${JSON.stringify(join(data, 'workspace', 'effect.txt'))}
        let approval
        let approvals
        let queued
        if (scenario === 'unsafe-crash') {
          await poll(async () => {
            const value = await readFile(effect, 'utf8').catch(() => '')
            if (!value) {
              const state = await json('/threads/crash-thread')
              if (state.approvals.length) throw new Error('Restricted command unexpectedly requires approval: ' + JSON.stringify(state.approvals))
              if ((await json('/threads/crash-thread/submissions/' + admitted.submissionId)).status === 'done') throw new Error('Restricted effect did not run: ' + JSON.stringify(state.snapshot.entries))
            }
            return value
          }, value => value.trim() === 'once')
          const directories = await readdir(${JSON.stringify(join(data, 'sandbox'))})
          if (!directories.length) throw new Error('Restricted run did not allocate sandbox resources')
        } else {
          approvals = await poll(() => json('/threads/crash-thread/approvals'), value => value.length === (delegated ? 2 : 1))
          approval = approvals[0]
          if (delegated) await poll(() => json('/threads/crash-thread'), value => JSON.stringify(value.snapshot.entries).includes('At most two child conversations'))
          queued = await json('/threads/crash-thread/submissions', { type: 'input', content: 'queued-original', requestId: 'queue-request', whenBusy: 'followUp' })
          await json('/threads/crash-thread/queue/item', { mode: 'followUp', expected: ['queued-original'], index: 0, action: 'edit', value: 'queued-edited' })
          if (cancelled) await fetch(base + '/threads/crash-thread/cancel', { method: 'POST' }).then(response => { if (!response.ok) throw new Error('Cancel failed') })
        }
        restored.child.kill()
        await restored.exited
        const recovered = start()
        base = (await recovered.ready).baseUrl
        const repeated = await json('/threads/crash-thread/submissions', request)
        if (repeated.submissionId !== admitted.submissionId) throw new Error('Crash recovery duplicated submission')
        if (scenario === 'approval-crash' || scenario === 'delegation-crash') {
          const pending = await poll(() => json('/threads/crash-thread/approvals'), value => value.length === (delegated ? 2 : 1))
          if (JSON.stringify(pending.map(item => item.id).sort()) !== JSON.stringify(approvals.map(item => item.id).sort()) || pending.some(item => item.state !== 'pending')) throw new Error('Recovery changed or auto-approved the request')
          if (await readFile(effect, 'utf8').catch(() => '') !== '') throw new Error('Pending approval caused an effect')
          const state = await json('/threads/crash-thread')
          if (state.queue.length !== 1 || state.queue[0].id !== queued.submissionId || state.queue[0].content !== 'queued-edited') throw new Error('Queue was not restored from official state')
          const retry = await json('/threads/crash-thread/submissions', { type: 'input', content: 'queued-original', requestId: 'queue-request', whenBusy: 'followUp' })
          if (retry.submissionId !== queued.submissionId) throw new Error('Lost queue acknowledgement duplicated work')
          for (const item of pending) await json('/threads/crash-thread/approvals/' + item.id, { state: 'approved' })
          await poll(() => json('/threads/crash-thread/submissions/' + queued.submissionId), value => value.status === 'done')
          const effects = delegated ? approvals.map(item => join(${JSON.stringify(join(data, 'workspace'))}, item.arguments.path)) : [effect]
          for (const file of effects) if ((await readFile(file, 'utf8')).trim() !== 'once') throw new Error('Approved effect changed')
        } else if (cancelled) {
          if ((await json('/threads/crash-thread/approvals')).length) throw new Error('Cancelled approval remained pending')
          const stale = await fetch(base + '/threads/crash-thread/approvals/' + approval.id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'approved' }) })
          if (stale.status !== 409) throw new Error('Stale approval accepted after crash')
          if (await readFile(effect, 'utf8').catch(() => '') !== '') throw new Error('Cancelled work caused an effect')
          if (delegated) for (const item of approvals) if (await readFile(join(${JSON.stringify(join(data, 'workspace'))}, item.arguments.path), 'utf8').catch(() => '') !== '') throw new Error('Cancelled child caused an effect')
          if ((await json('/threads/crash-thread/submissions/' + queued.submissionId)).status !== 'unanswered') throw new Error('Cancelled queued work resumed')
        } else {
          await poll(() => json('/threads/crash-thread/submissions/' + admitted.submissionId), value => value.status === 'done' || value.status === 'unanswered')
          const state = await json('/threads/crash-thread')
          if (!JSON.stringify(state.snapshot.entries).includes('interrupted')) throw new Error('Unsafe interruption was not reported')
          if ((await readFile(effect, 'utf8')).trim() !== 'once') throw new Error('Unsafe side effect was replayed')
        }
        await recovered.close()
        if (scenario === 'unsafe-crash' && (await readdir(${JSON.stringify(join(data, 'sandbox'))})).length) throw new Error('Recovered resources were not collected')
        crash = { scenario, submissionId: admitted.submissionId, recovered: true }
      } else await restored.close()
      process.stdout.write('PRODUCTION_SMOKE=' + JSON.stringify({ snapshot, runs, records, crash }) + '\\n')
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
    if (scenario === 'lifecycle') expect(calls).toBe(1)
    else expect(result.crash).toMatchObject({ scenario, recovered: true })
    if (scenario.startsWith('delegation')) {
      const children = modelRequests.filter(body => JSON.stringify(body.messages.filter((message: { role: string }) => message.role === 'user').at(-1)?.content).includes('approval-effect child-'))
      expect(children.length).toBe(scenario === 'delegation-crash' ? 4 : 2)
      for (const request of children) expect(JSON.stringify(request)).not.toContain('root-secret')
    }
    expect(result.runs).toEqual([expect.objectContaining({ status: 'completed', result: 'Production host accepted.' })])
    expect(result.records.map((record) => record.event.type)).toEqual(['agent_started', 'text_delta', 'agent_completed'])
    expect(JSON.stringify(result.snapshot.snapshot.entries)).toContain('Production host accepted.')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
    await rm(data, { recursive: true, force: true })
  }
}, 60000)
