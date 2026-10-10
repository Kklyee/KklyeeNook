import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'
import { expect, test } from 'vitest'
import { runDurableSmoke } from './testing/durable-smoke'

const execute = promisify(execFile)

test('opens SQLite, answers an input, closes and reopens without duplicating it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-durable-'))
  try {
    const result = await runDurableSmoke(join(directory, 'agent-durable.sqlite'))
    expect(result.modelCalls).toBe(1)
    expect(result.entryIds).toHaveLength(2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

test('runs the same Harness smoke inside an Electron utility process', async () => {
  const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.nook-durable-'))
  try {
    const source = await readFile(new URL('./testing/durable-smoke.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    })
    await writeFile(join(directory, 'durable-smoke.mjs'), compiled.outputText)
    await writeFile(
      join(directory, 'entry.mjs'),
      `
import { runDurableSmoke } from './durable-smoke.mjs'
try {
  process.parentPort.postMessage(await runDurableSmoke(process.argv[2]))
  setImmediate(() => process.exit(0))
} catch (error) {
  console.error(error)
  process.exit(1)
}
`,
    )
    await writeFile(
      join(directory, 'main.mjs'),
      `
import { app, utilityProcess } from 'electron'
import { fileURLToPath } from 'node:url'
app.whenReady().then(() => {
  const child = utilityProcess.fork(fileURLToPath(new URL('./entry.mjs', import.meta.url)), [process.argv[2]], {
    serviceName: 'KKlyeeNook Durable Smoke', stdio: 'pipe',
  })
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  child.on('message', result => process.stdout.write('DURABLE_SMOKE=' + JSON.stringify(result) + '\\n'))
  child.on('exit', code => app.exit(code))
})
`,
    )
    const electron: string = createRequire(import.meta.url)('electron')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const { stdout } = await execute(
      electron,
      [join(directory, 'main.mjs'), join(directory, 'agent-durable.sqlite')],
      { env, windowsHide: true, timeout: 30_000 },
    )
    const line = stdout.split(/\r?\n/).find((value) => value.startsWith('DURABLE_SMOKE='))
    expect(line).toBeDefined()
    const result = JSON.parse(line!.slice('DURABLE_SMOKE='.length))
    expect(result.modelCalls).toBe(1)
    expect(result.entryIds).toHaveLength(2)
    expect(result.electron).toBe(createRequire(import.meta.url)('electron/package.json').version)
    expect(Number(result.node.split('.')[0])).toBeGreaterThanOrEqual(22)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 40_000)
