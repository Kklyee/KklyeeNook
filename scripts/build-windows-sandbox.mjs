import { copyFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { userInfo } from 'node:os'

if (process.platform === 'win32') {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const project = join(root, 'native', 'windows-sandbox')
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
  const output = join(root, 'resources', 'sandbox')
  mkdirSync(output, { recursive: true })
  const target = join(output, 'windows-sandbox.exe')
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
}
