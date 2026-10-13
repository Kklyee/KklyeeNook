import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, test } from 'vitest'

test('real virtual messages reach the DOM bottom after clicking latest and growing the last message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-scroll-'))
  try {
    await build({
      stdin: {
        resolveDir: dirname(fileURLToPath(import.meta.url)),
        loader: 'tsx',
        contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime, useAuiState } from '@assistant-ui/react'
        import { ThreadScrollViewport, useScrollFollower } from './thread-scroll-follower'
        import { ThreadMessages } from './thread-messages'
        const messages = Array.from({ length: 60 }, (_, index) => ({ id: String(index), role: 'assistant', content: [{ type: 'text', text: String(index) }], createdAt: new Date(index) }))
        function Message() {
          const id = useAuiState(state => state.message.id)
          return <div data-message={id} style={{ height: 120 + Number(id) % 5 * 180 }}>{id}</div>
        }
        const components = { Message }
        function Footer() {
          const follower = useScrollFollower()
          return <div style={{ position: 'sticky', bottom: 0, height: 100, background: 'white' }}><button id="latest" onClick={follower.resume} data-following={follower.following}>Latest</button></div>
        }
        function App() {
          const runtime = useExternalStoreRuntime({ messages, convertMessage: message => message, isRunning: false, onNew: async () => {} })
          return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root><ThreadScrollViewport data-test="scroll-viewport" style={{ height: 500, width: 700, overflow: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingTop: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 56 }}><ThreadMessages components={components} /></div>
              <Footer />
            </div>
          </ThreadScrollViewport></ThreadPrimitive.Root></AssistantRuntimeProvider>
        }
        createRoot(document.getElementById('root')).render(<App />)
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
        window.verifyScroll = async () => {
          await sleep(300)
          const viewport = document.querySelector('[data-test="scroll-viewport"]')
          const position = () => ({ top: viewport.scrollTop, height: viewport.scrollHeight, client: viewport.clientHeight, remaining: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop, visible: [...document.querySelectorAll('[data-message]')].filter(element => { const rect = element.getBoundingClientRect(); const view = viewport.getBoundingClientRect(); return rect.bottom > view.top && rect.top < view.bottom }).length, rendered: document.querySelectorAll('[data-message]').length, ids: [...document.querySelectorAll('[data-message]')].map(element => element.dataset.message) })
          viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
          viewport.scrollTop = 500
          viewport.dispatchEvent(new Event('scroll'))
          await sleep(300)
          const before = position()
          document.getElementById('latest').click()
          await sleep(1000)
          const after = position()
          const last = document.querySelector('[data-message="59"]')
          if (last) last.style.height = '2000px'
          await sleep(500)
          return { before, after, grown: position(), lastVisible: !!last }
        }
      `,
      },
      bundle: true,
      jsx: 'automatic',
      format: 'iife',
      outfile: join(directory, 'fixture.js'),
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    await writeFile(
      join(directory, 'fixture.html'),
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"><style>.relative{position:relative}.absolute{position:absolute}.top-0{top:0}.left-0{left:0}.w-full{width:100%}.flex{display:flex}.flex-col{flex-direction:column}.min-h-full{min-height:100%}.shrink-0{flex-shrink:0}</style><div id="root"></div><script src="fixture.js"></script>`,
    )
    await writeFile(
      join(directory, 'runner.mjs'),
      `
      import { app, BrowserWindow } from 'electron'
      app.setPath('userData', ${JSON.stringify(join(directory, 'browser-data'))})
      app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 800, height: 650, webPreferences: { backgroundThrottling: false } })
      try {
        await window.loadFile(${JSON.stringify(join(directory, 'fixture.html'))})
        const result = await window.webContents.executeJavaScript('window.verifyScroll()')
        console.log('SCROLL_RESULT:' + JSON.stringify(result))
      } catch (error) { console.error(error); process.exitCode = 1 } finally { app.quit() }
      })
    `,
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const { stdout, stderr } = await promisify(execFile)(
      createRequire(import.meta.url)('electron'),
      [join(directory, 'runner.mjs')],
      { env, windowsHide: true, timeout: 45_000 },
    ).catch((error) => {
      throw new Error(
        JSON.stringify({
          message: error.message,
          stdout: error.stdout,
          stderr: error.stderr,
          signal: error.signal,
        }),
      )
    })
    if (!stdout.includes('SCROLL_RESULT:')) throw new Error(stdout + stderr)
    const result = JSON.parse(stdout.split('SCROLL_RESULT:')[1].split('\n')[0])
    expect(result.before.remaining, JSON.stringify(result)).toBeGreaterThan(1000)
    expect(result.before.visible, JSON.stringify(result)).toBeGreaterThan(0)
    expect(result.after.remaining, JSON.stringify(result)).toBeLessThanOrEqual(1)
    expect(result.after.visible, JSON.stringify(result)).toBeGreaterThan(0)
    expect(result.grown.remaining, JSON.stringify(result)).toBeLessThanOrEqual(1)
    expect(result.lastVisible, JSON.stringify(result)).toBe(true)
    expect(result.after.rendered).toBeLessThan(20)
  } finally {
    assert.equal(dirname(directory), tmpdir())
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
