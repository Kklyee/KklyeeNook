import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveConfig } from 'electron-vite'
import { build } from 'vite'
import { expect, test } from 'vitest'

const execute = promisify(execFile)

test('built desktop renders the real runtime, submits from the composer and restores its persisted conversation after refresh', async () => {
  const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.nook-desktop-'))
  const data = await mkdtemp(join(tmpdir(), 'nook-desktop-data-'))
  let calls = 0
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {}
    calls++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const text of ['Desktop ', 'production reply.']) {
      response.write('data: ' + JSON.stringify({ id: 'desktop', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) + '\n\n')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    response.end('data: ' + JSON.stringify({ id: 'desktop', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Model server did not bind')
    await writeFile(join(data, 'agent-settings.json'), JSON.stringify({ model: { provider: 'test-provider', modelID: 'test-model', api: 'openai-completions', baseUrl: `http://127.0.0.1:${address.port}/v1` }, tools: { enabled: [] }, compaction: { enabled: false, reserveTokens: 1000, keepRecentTokens: 1000 } }))
    await cp(join(process.cwd(), 'drizzle'), join(directory, 'drizzle'), { recursive: true })
    await mkdir(join(directory, 'resources'))
    await cp(join(process.cwd(), 'resources', 'sandbox'), join(directory, 'resources', 'sandbox'), { recursive: true })
    const config = await resolveConfig({ build: { outDir: directory }, logLevel: 'silent' }, 'build', 'production')
    for (const target of [config.config!.main!, config.config!.preload!, config.config!.renderer!]) await build(target)
    const script = `
import { app } from 'electron'
app.setPath('userData', ${JSON.stringify(data)})
app.on('browser-window-created', (_event, window) => {
  window.webContents.debugger.attach('1.3')
  window.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown' || method === 'Network.loadingFailed') console.error(method + ' ' + JSON.stringify(params)) })
  void window.webContents.debugger.sendCommand('Runtime.enable')
  void window.webContents.debugger.sendCommand('Network.enable')
  window.webContents.setBackgroundThrottling(false)
  window.on('show', () => window.hide())
  window.webContents.on('console-message', details => console.error('Renderer: ' + details.message))
  window.webContents.on('did-fail-load', (_event, code, description, url) => console.error('Load failed: ' + code + ' ' + description + ' ' + url))
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(${JSON.stringify(`(${verifyDesktop.toString()})()`)})
      const click = async point => {
        await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
        await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
        await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
      }
      await click(result.more)
      const rename = await window.webContents.executeJavaScript(${JSON.stringify(`(${findRename.toString()})()`)})
      await click(rename)
      await window.webContents.executeJavaScript(${JSON.stringify(`(${verifyRename.toString()})()`)})
      const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve))
      window.webContents.reload()
      await loaded
      const restored = await window.webContents.executeJavaScript(${JSON.stringify(`(${verifyDesktopRefresh.toString()})()`)})
      process.stdout.write('DESKTOP_SMOKE=' + JSON.stringify({ ...result, restored }) + '\\n')
      app.quit()
    } catch (error) { console.error(error); app.exit(1) }
  })
})
await import('./main/index.mjs')
`
    const path = join(directory, 'main.mjs')
    await writeFile(path, script)
    await execute(process.execPath, ['--check', path], { windowsHide: true })
    const env: NodeJS.ProcessEnv = { ...process.env, API_KEY: 'synthetic-key', HOME: data, USERPROFILE: data }
    delete env.ELECTRON_RUN_AS_NODE
    Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
    const { stdout } = await execute(createRequire(import.meta.url)('electron'), [path], { env, windowsHide: true, timeout: 60000 }).catch(error => { throw new Error(error.message + '\n' + error.stdout) })
    const line = stdout.split(/\r?\n/).find(value => value.startsWith('DESKTOP_SMOKE='))
    expect(line).toBeDefined()
    expect(JSON.parse(line!.slice('DESKTOP_SMOKE='.length))).toMatchObject({ submitted: true, restored: true, protocol: 'agent' })
    expect(calls).toBe(1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
    await rm(data, { recursive: true, force: true })
  }
}, 150000)

async function verifyDesktop() {
  const api = (window as unknown as { api: any }).api
  const wait = async (condition: () => unknown | Promise<unknown>) => {
    const until = Date.now() + 20000
    while (Date.now() < until) {
      const value = await condition()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Desktop condition timed out: ' + condition.toString() + ' ' + document.body.innerText.slice(0, 1500) + ' ' + document.body.innerHTML.slice(0, 500))
  }
  const status = await wait(async () => { const status = await api.agentBackend.getStatus(); return status.state === 'ready' && status }) as { info: { baseUrl: string } }
  if (!status.info.baseUrl.endsWith('/api/agent')) throw new Error('Desktop selected the legacy protocol')
  const input = await wait(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')) as HTMLTextAreaElement
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Desktop request')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const send = await wait(() => document.querySelector<HTMLButtonElement>('.aui-composer-send:not(:disabled)')) as HTMLButtonElement
  send.click()
  await wait(() => document.querySelector('[data-slot="aui_assistant-message-root"]')?.textContent?.includes('Desktop production reply.'))
  await wait(() => !document.querySelector('.aui-composer-cancel'))
  const sessions = await api.conversations.list()
  if (sessions.length !== 1) throw new Error('Composer created duplicate conversations')
  const id = sessions[0].id
  const json = async (path: string) => {
    const response = await fetch(status.info.baseUrl + path)
    if (!response.ok) throw new Error('Desktop snapshot request failed')
    return response.json()
  }
  const persisted = await json('/threads/' + id)
  if (!JSON.stringify(persisted.snapshot.entries).includes('Desktop production reply.')) throw new Error('Displayed message was not persisted')
  const row = await wait(() => document.querySelector<HTMLButtonElement>('[data-slot="aui_thread-list-item-trigger"]')) as HTMLButtonElement
  row.click()
  const more = await wait(() => document.querySelector<HTMLButtonElement>('[data-slot="aui_thread-list-item-more"]')) as HTMLButtonElement
  const box = more.getBoundingClientRect()
  return { submitted: true, protocol: 'agent', id, more: { x: box.x + box.width / 2, y: box.y + box.height / 2 } }
}

async function findRename() {
  const until = Date.now() + 10000
  while (Date.now() < until) {
    const rename = [...document.querySelectorAll<HTMLElement>('[data-slot="aui_thread-list-item-more-item"]')].find(item => item.textContent?.trim() === 'Rename')
    if (rename) {
      const box = rename.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Desktop rename menu did not open: ' + document.body.innerText.slice(0, 1500))
}

async function verifyRename() {
  const api = (window as unknown as { api: any }).api
  const until = Date.now() + 10000
  let title: HTMLInputElement | null = null
  while (Date.now() < until && !title) {
    title = document.querySelector<HTMLInputElement>('[aria-label="Rename thread"]')
    if (!title) await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (!title) throw new Error('Rename input did not mount')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Desktop renamed')
  title.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 0))
  title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  while (Date.now() < until) {
    if ((await api.conversations.list())[0]?.title === 'Desktop renamed' && document.querySelector('[data-slot="aui_thread-list-item-trigger"]')?.textContent?.includes('Desktop renamed')) return true
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Rename was not persisted and projected into the sidebar')
}

async function verifyDesktopRefresh() {
  const until = Date.now() + 20000
  while (Date.now() < until) {
    const row = document.querySelector<HTMLButtonElement>('[data-slot="aui_thread-list-item-trigger"]')
    if (row?.textContent?.includes('Desktop renamed')) {
      row.click()
      break
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  while (Date.now() < until) {
    const messages = document.querySelectorAll('[data-slot="aui_assistant-message-root"]')
    if (messages.length === 1 && messages[0].textContent?.includes('Desktop production reply.')) return true
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Renderer refresh did not restore the persisted conversation: ' + document.body.innerText.slice(0, 1500))
}
