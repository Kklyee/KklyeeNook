import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import type { RemoteSettings, RemoteStatus } from '@kklyeenook/shared/remote/index'
import type { RemoteAgentPort } from './remoteAgentPort'
import { startRemoteGateway, type RunningRemoteGateway } from './remoteGateway'

const exec = promisify(execFile)

export async function readTailscaleStatus(): Promise<Pick<RemoteStatus, 'tailscale' | 'url' | 'ownerLogin'>> {
  try {
    const executable = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe') : 'tailscale'
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
