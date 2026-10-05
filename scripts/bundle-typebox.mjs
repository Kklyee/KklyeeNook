import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
for (const directory of [
  join(root, 'node_modules', 'typebox'),
  join(root, 'node_modules', '@earendil-works', 'pi-coding-agent', 'node_modules', 'typebox'),
]) {
  const manifestPath = join(directory, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const exports = Object.entries(manifest.exports)
  if (exports.every(([, entry]) =>
    typeof entry.import === 'object' &&
    entry.import.default.startsWith('./build/kklyeenook-startup/') &&
    existsSync(join(directory, entry.import.default)),
  )) continue

  const entries = Object.fromEntries(exports.map(([name, entry]) => [
    name === '.' ? 'index' : name.slice(2),
    join(directory, entry.import),
  ]))
  await build({
    configFile: false,
    root: directory,
    logLevel: 'warn',
    build: {
      outDir: join(directory, 'build', 'kklyeenook-startup'),
      emptyOutDir: false,
      minify: false,
      target: 'es2022',
      lib: { entry: entries, formats: ['es'], fileName: (_format, name) => `${name}.mjs` },
      rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].mjs' } },
    },
  })
  manifest.exports = Object.fromEntries(exports.map(([name, entry]) => {
    const runtime = `./build/kklyeenook-startup/${name === '.' ? 'index' : name.slice(2)}.mjs`
    return [name, {
      import: { types: entry.import.replace(/\.mjs$/, '.d.mts'), default: runtime },
      default: runtime,
    }]
  }))
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.info(`Bundled TypeBox ${manifest.version} for startup`)
}
