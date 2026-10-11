import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { userInfo } from 'node:os'

if (process.platform === 'win32') {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const project = join(root, 'native', 'windows-sandbox')
  const output = join(root, 'resources', 'sandbox')
  const target = join(output, 'windows-sandbox.exe')
  const stamp = join(project, 'target', 'app-build-fingerprint')
  const inputs = [
    'Cargo.toml',
    'Cargo.lock',
    ...readdirSync(join(project, 'src'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(relative(project, entry.parentPath), entry.name)),
  ].sort()
  const hash = createHash('sha256').update(`${process.platform}:${process.arch}`)
  for (const input of inputs) {
    hash.update(input)
    hash.update(readFileSync(join(project, input)))
  }
  const fingerprint = hash.digest('hex')
  if (existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8') === fingerprint) {
    console.info('Windows sandbox is up to date')
    process.exit(0)
  }
  const build = spawnSync(
    'cargo',
    ['build', '--release', '--locked', '--manifest-path', join(project, 'Cargo.toml')],
    { stdio: 'inherit', windowsHide: true },
  )
  if (build.error)
    throw new Error('Building the Windows sandbox requires Rust with the MSVC toolchain', {
      cause: build.error,
    })
  if (build.status !== 0) process.exit(build.status ?? 1)
  mkdirSync(output, { recursive: true })
  copyFileSync(join(project, 'target', 'release', 'windows-sandbox.exe'), target)
  for (const args of [
    [target, '/grant:r', `${userInfo().username}:(F)`],
    [target, '/setintegritylevel', 'M'],
  ]) {
    const permissions = spawnSync(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'),
      args,
      { stdio: 'inherit', windowsHide: true },
    )
    if (permissions.error) throw permissions.error
    if (permissions.status !== 0) process.exit(permissions.status ?? 1)
  }
  writeFileSync(stamp, fingerprint)
}
