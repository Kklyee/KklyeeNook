import { spawnSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { join } from 'node:path'

export default function ({ electronPlatformName, appOutDir }) {
  if (electronPlatformName !== 'win32') return
  const helper = join(appOutDir, 'resources', 'app.asar.unpacked', 'resources', 'sandbox', 'windows-sandbox.exe')
  for (const args of [
    [helper, '/grant:r', `${userInfo().username}:(F)`],
    [helper, '/setintegritylevel', 'M'],
  ]) {
    const result = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), args, { windowsHide: true, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error('Packaged sandbox permissions could not be prepared')
  }
}
