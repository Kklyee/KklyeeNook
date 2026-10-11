import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { win32 } from 'node:path'
import type { RemoteSettings, RemoteStatus } from '@kklyeenook/shared/remote/index'
import type { RemoteAgentPort } from './remoteAgentPort'
import { startRemoteGateway, type RunningRemoteGateway } from './remoteGateway'

const exec = promisify(execFile)

async function tailscaleExecutable(): Promise<string> {
  if (process.platform !== 'win32') return 'tailscale'
  const standard = win32.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe')
  if (existsSync(standard)) return standard
  try {
    const registry = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
    const { stdout } = await exec(registry, ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tailscale', '/v', 'ImagePath'], { timeout: 5000, windowsHide: true })
    const imagePath = stdout.match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/)?.[1].trim()
    const service = imagePath?.match(/^"([^"]+)"|^(.+?\.exe)(?:\s|$)/i)
    if (service) return win32.join(win32.dirname(service[1] ?? service[2]), 'tailscale.exe')
  } catch {}
  return 'tailscale'
}

export async function readTailscaleStatus(): Promise<Pick<RemoteStatus, 'tailscale' | 'url' | 'ownerLogin'>> {
  try {
    const executable = await tailscaleExecutable()
    const { stdout } = await exec(executable, ['status', '--json'], { timeout: 5000, windowsHide: true })
    const status = JSON.parse(stdout)
    const dnsName = status.Self?.DNSName?.replace(/\.$/, '')
    return {
      tailscale: status.BackendState === 'Running' ? 'connected' : 'disconnected',
      url: dnsName ? `https://${dnsName}` : undefined,
      ownerLogin: status.User?.[status.Self?.UserID]?.LoginName,
    }
  } catch { return { tailscale: 'unavailable' } }
}

export class RemoteController {
  private gateway?: RunningRemoteGateway
  private settings: RemoteSettings = { enabled: false }
  private tailscale: Pick<RemoteStatus, 'tailscale' | 'url' | 'ownerLogin'> = { tailscale: 'unavailable' }
  private error?: string
  private refreshTimer?: ReturnType<typeof setInterval>

  constructor(private readonly port: RemoteAgentPort, private readonly staticRoot: string) {}

  async configure(settings: RemoteSettings): Promise<RemoteStatus> {
    this.settings = settings
    this.error = undefined
    this.tailscale = await readTailscaleStatus()
    if (!settings.enabled) {
      await this.close()
    } else if (!this.gateway) {
      try {
        this.gateway = await startRemoteGateway(this.port, {
          staticRoot: this.staticRoot,
          identity: () => ({
            allowedLogin: this.settings.allowedLogin || this.tailscale.ownerLogin,
            origin: this.tailscale.tailscale === 'connected' ? this.tailscale.url : undefined,
          }),
        })
        this.refreshTimer = setInterval(() => { void readTailscaleStatus().then(status => { this.tailscale = status }) }, 30_000)
        this.refreshTimer.unref()
      } catch { this.error = 'Unable to start Remote Gateway on 127.0.0.1:43127' }
    }
    return { ...this.settings, ...this.tailscale, running: !!this.gateway, error: this.error }
  }

  async status(): Promise<RemoteStatus> {
    this.tailscale = await readTailscaleStatus()
    return { ...this.settings, ...this.tailscale, running: !!this.gateway, error: this.error }
  }

  async close(): Promise<void> {
    clearInterval(this.refreshTimer)
    this.refreshTimer = undefined
    await this.gateway?.close()
    this.gateway = undefined
  }
}
