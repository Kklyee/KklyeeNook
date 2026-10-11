import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const resources = fileURLToPath(new URL('../dist/win-unpacked/resources', import.meta.url))
const entry = join(resources, 'app.asar', 'out', 'main', 'agent-backend-entry.mjs')
const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.nook-package-'))
const data = await mkdtemp(join(tmpdir(), 'nook-package-data-'))
const calls = [
  ['write', { path: 'file.txt', content: 'alpha\nbeta\n' }],
  ['edit', { path: 'file.txt', edits: [{ oldText: 'alpha', newText: 'updated' }] }],
  ['read', { path: 'pixel.jpg' }],
  ['find', { pattern: '**/*.txt' }],
  ['grep', { pattern: 'updated', literal: true }],
  ['bash', { command: 'Write-Output packaged-shell' }],
]
let requests = 0
const server = createServer(async (request, response) => {
  for await (const _chunk of request) {}
  const call = calls[requests++]
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: 'package-' + requests, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } : { role: 'assistant', content: 'Packaged tools passed.' }
  response.write('data: ' + JSON.stringify({ id: 'package', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n')
  response.end('data: ' + JSON.stringify({ id: 'package', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
try {
  const address = server.address()
  await mkdir(join(data, 'workspace'))
  await writeFile(join(data, 'workspace', 'pixel.jpg'), Buffer.from('/9j/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64'))
  const options = { config: { model: { provider: 'test-provider', modelID: 'test-model', api: 'openai-completions', baseUrl: 'http://127.0.0.1:' + address.port + '/v1' }, tools: { enabled: calls.map(call => call[0]) }, compaction: { enabled: false, reserveTokens: 1000, keepRecentTokens: 1000 } }, apiKeys: { 'test-provider': 'synthetic-key' }, databaseUrl: 'file:' + join(data, 'business.sqlite'), dataDir: data, migrationsPath: join(resources, 'drizzle'), allowedOrigins: [] }
  const wrapper = join(directory, 'utility.mjs')
  await writeFile(wrapper, 'Object.defineProperty(process, "resourcesPath", { value: ' + JSON.stringify(resources) + ' });\nawait import(' + JSON.stringify(pathToFileURL(entry).href) + ');\n')
  const script = `
import { app, utilityProcess } from 'electron'
app.setPath('userData', ${JSON.stringify(data)})
app.whenReady().then(async () => {
  const children = new Set()
  const start = () => {
    const child = utilityProcess.fork(${JSON.stringify(wrapper)}, [], { env: { ...process.env, HOME: ${JSON.stringify(data)}, USERPROFILE: ${JSON.stringify(data)} }, stdio: 'pipe' })
    children.add(child)
    child.stderr.pipe(process.stderr)
    let sequence = 0
    const pending = new Map()
    const ready = new Promise((resolve, reject) => child.on('message', message => {
      if (message.type === 'failed') reject(new Error(message.message))
      if (message.type === 'ready') resolve(message.info.baseUrl)
      if (message.type === 'response') {
        const receiver = pending.get(message.id)
        pending.delete(message.id)
        message.ok ? receiver?.resolve(message.value) : receiver?.reject(new Error(message.message))
      }
    }))
    const exited = new Promise(resolve => child.once('exit', code => { children.delete(child); resolve(code) }))
    child.once('spawn', () => child.postMessage({ type: 'initialize', options: ${JSON.stringify(options)} }))
    return { ready, rpc: (action, request) => new Promise((resolve, reject) => { const requestId = String(++sequence); pending.set(requestId, { resolve, reject }); child.postMessage({ type: 'request', requestId, action, ...request }) }), close: async () => { child.postMessage({ type: 'shutdown' }); if (await exited !== 0) throw new Error('Packaged backend shutdown failed') } }
  }
  try {
    const backend = start()
    let base = await backend.ready
    const json = async (path, body) => { const response = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined); if (!response.ok) throw new Error(await response.text()); return response.json() }
    const workspace = await backend.rpc('workspace:attach', { path: ${JSON.stringify(join(data, 'workspace'))} })
    await json('/threads', { threadId: 'package-thread', workspaceId: workspace.workspace.id, permissionMode: 'workspace-write' })
    const input = { type: 'input', content: 'Verify packaged tools', requestId: 'package-request' }
    const accepted = await json('/threads/package-thread/submissions', input)
    const until = Date.now() + 30000
    let status
    do { status = await json('/threads/package-thread/submissions/' + accepted.submissionId); if (status.status === 'done') break; await new Promise(resolve => setTimeout(resolve, 25)) } while (Date.now() < until)
    if (status.status !== 'done') {
      const state = await json('/threads/package-thread')
      throw new Error('Packaged submission did not finish: ' + JSON.stringify({ status, tools: state.snapshot.tools, approvals: state.approvals }))
    }
    const snapshot = await json('/threads/package-thread')
    const results = snapshot.snapshot.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult')
    if (results.length !== 6 || results.some(result => result.isError)) throw new Error('Packaged tool failure: ' + JSON.stringify(results))
    if (!results.find(result => result.toolName === 'read').content.some(part => part.type === 'image' && part.mimeType === 'image/webp')) throw new Error('Packaged Sharp did not produce an image')
    for (const name of ['find', 'grep']) if (!JSON.stringify(results.find(result => result.toolName === name)).includes('file.txt')) throw new Error('Packaged ripgrep did not execute')
    if (!JSON.stringify(results.find(result => result.toolName === 'bash')).includes('packaged-shell')) throw new Error('Packaged sandbox did not execute')
    await backend.close()
    const recovered = start()
    base = await recovered.ready
    if ((await json('/threads/package-thread/submissions', input)).submissionId !== accepted.submissionId) throw new Error('Packaged recovery duplicated admission')
    if (!JSON.stringify((await json('/threads/package-thread')).snapshot.entries).includes('Packaged tools passed.')) throw new Error('Packaged history was lost')
    await recovered.close()
    process.stdout.write('PACKAGED_SMOKE=6 tools and recovery passed\\n')
    app.quit()
  } catch (error) { console.error(error); await Promise.all([...children].map(child => new Promise(resolve => { child.once('exit', resolve); child.kill() }))); app.exit(1) }
})
`
  const scriptPath = join(directory, 'main.mjs')
  await writeFile(scriptPath, script)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await execute(createRequire(import.meta.url)('electron'), [scriptPath], { env, windowsHide: true, timeout: 60000 }).catch(error => { throw new Error(error.message + '\n' + error.stderr) })
  if (!result.stdout.includes('PACKAGED_SMOKE=')) throw new Error('Packaged verification did not complete')
  if (requests !== 7) throw new Error('Packaged recovery repeated model work')
  if ((await readFile(join(data, 'workspace', 'file.txt'), 'utf8')) !== 'updated\nbeta\n') throw new Error('Packaged edit lost its changes')
  console.log(result.stdout.trim())
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
  await rm(data, { recursive: true, force: true })
}
