import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readTailscaleStatus } from './remoteController'

const { run, exists } = vi.hoisted(() => ({ run: vi.fn(), exists: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: run }) }))
vi.mock('node:fs', () => ({ existsSync: exists }))

const platform = process.platform
const status = { BackendState: 'Running', Self: { DNSName: 'desktop.example.ts.net.', UserID: 1 }, User: { 1: { LoginName: 'kk@example.com' } } }
const connected = { tailscale: 'connected', url: 'https://desktop.example.ts.net', ownerLogin: 'kk@example.com' }

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  vi.stubEnv('ProgramFiles', 'C:\\Program Files')
  vi.stubEnv('SystemRoot', 'C:\\Windows')
  run.mockReset()
  exists.mockReset()
})
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }); vi.unstubAllEnvs() })

test('detects a custom Windows installation from the Tailscale service', async () => {
  exists.mockReturnValue(false)
  run.mockImplementation(async executable => {
    if (executable === 'C:\\Windows\\System32\\reg.exe') return { stdout: '    ImagePath    REG_SZ    D:\\software\\Tailscale\\tailscaled.exe\r\n' }
    if (executable === 'D:\\software\\Tailscale\\tailscale.exe') return { stdout: JSON.stringify(status) }
    throw new Error('ENOENT')
  })
  expect(await readTailscaleStatus()).toEqual(connected)
})

test('uses the default Windows installation without querying the registry', async () => {
  exists.mockReturnValue(true)
  run.mockResolvedValue({ stdout: JSON.stringify(status) })
  expect(await readTailscaleStatus()).toEqual(connected)
  expect(run).toHaveBeenCalledExactlyOnceWith('C:\\Program Files\\Tailscale\\tailscale.exe', ['status', '--json'], { timeout: 5000, windowsHide: true })
})

test('handles a quoted service path with spaces and startup arguments', async () => {
  exists.mockReturnValue(false)
  run.mockResolvedValueOnce({ stdout: '    ImagePath    REG_SZ    "D:\\My Apps\\Tailscale\\tailscaled.exe" --state=state\r\n' }).mockResolvedValueOnce({ stdout: JSON.stringify(status) })
  expect(await readTailscaleStatus()).toEqual(connected)
  expect(run).toHaveBeenLastCalledWith('D:\\My Apps\\Tailscale\\tailscale.exe', ['status', '--json'], { timeout: 5000, windowsHide: true })
})

test('falls back to PATH when no Windows service is installed', async () => {
  exists.mockReturnValue(false)
  run.mockRejectedValueOnce(new Error('Service not found')).mockResolvedValueOnce({ stdout: JSON.stringify(status) })
  expect(await readTailscaleStatus()).toEqual(connected)
  expect(run).toHaveBeenLastCalledWith('tailscale', ['status', '--json'], { timeout: 5000, windowsHide: true })
})

test('uses PATH on other platforms and distinguishes disconnected from unavailable', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  run.mockResolvedValueOnce({ stdout: JSON.stringify({ BackendState: 'Stopped' }) }).mockRejectedValueOnce(new Error('CLI missing'))
  expect(await readTailscaleStatus()).toEqual({ tailscale: 'disconnected', url: undefined, ownerLogin: undefined })
  expect(await readTailscaleStatus()).toEqual({ tailscale: 'unavailable' })
  expect(exists).not.toHaveBeenCalled()
})
