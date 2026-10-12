import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beginRemoteDevSession } from './remote-dev-session.mjs'

const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const release = process.argv[2] === 'dev' ? await beginRemoteDevSession(root) : async () => {}
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env })
child.once('error', async (error) => {
  await release()
  console.error(error.message)
  process.exit(1)
})
child.once('exit', async (code, signal) => {
  await release()
  process.exit(signal ? 1 : (code ?? 0))
})
process.once('SIGINT', () => child.kill('SIGINT'))
process.once('SIGTERM', () => child.kill('SIGTERM'))
