import { useEffect, useState } from 'react'
import { CheckIcon, CopyIcon, RefreshCwIcon } from 'lucide-react'
import type { RemoteStatus } from '@kklyeenook/shared/remote/index'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SettingsCard, SettingsField } from './SettingsComponents'

export function RemoteSettings() {
  const [status, setStatus] = useState<RemoteStatus>()
  const [login, setLogin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let active = true
    window.api.remote.status().then(value => { if (active) { setStatus(value); setLogin(value.allowedLogin ?? '') } }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (busy) return
    let active = true
    const timer = setInterval(() => { void window.api.remote.status().then(value => { if (active) setStatus(value) }).catch(error => { if (active) setError(error.message) }) }, 10_000)
    return () => { active = false; clearInterval(timer) }
  }, [busy])
  const save = async (enabled: boolean) => {
    setBusy(true); setError('')
    try { setStatus(await window.api.remote.configure({ enabled, allowedLogin: login.trim() || undefined })) }
    catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="space-y-5">
    <SettingsCard>
      <SettingsField label="Enable Remote" description="在手机上通过 Tailscale 私网控制 Desktop Agent。"><Button variant="ghost" className="h-6 w-10 justify-self-end rounded-full p-0" role="switch" aria-label="Enable Remote" aria-checked={status?.enabled ?? false} disabled={busy || !status} onClick={() => { void save(!status?.enabled) }}><span className={`flex h-6 w-10 items-center rounded-full p-0.5 ${status?.enabled ? 'bg-brand' : 'bg-muted'}`}><span className={`size-5 rounded-full bg-white transition-transform ${status?.enabled ? 'translate-x-4' : ''}`} /></span></Button></SettingsField>
      <SettingsField label="Status" description="Remote Gateway · 127.0.0.1:43127"><p className="text-sm">{status ? status.running ? '● Running' : status.enabled ? '● Unavailable' : '○ Disabled' : '读取中…'}</p></SettingsField>
      <SettingsField label="Tailscale" description="需要在电脑和手机上安装并连接 Tailscale。"><p className="text-sm">{status?.tailscale === 'connected' ? '● Connected' : status?.tailscale === 'disconnected' ? '○ Disconnected' : '○ Unavailable'}</p></SettingsField>
      <SettingsField label="Remote URL" description="在手机浏览器打开后添加到主屏幕。"><div className="flex min-w-0 items-center gap-2"><Input readOnly value={status?.url ?? ''} placeholder="Tailscale 连接后显示" aria-label="Remote URL" /><Button variant="outline" size="icon" disabled={!status?.url} aria-label="Copy URL" onClick={async () => { await navigator.clipboard.writeText(status!.url!); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>{copied ? <CheckIcon /> : <CopyIcon />}</Button></div></SettingsField>
      <SettingsField label="Allowed User" description="留空时仅允许当前电脑所属的 Tailscale 用户。"><div className="flex gap-2"><Input value={login} placeholder={status?.ownerLogin ?? 'user@example.com'} aria-label="Allowed Tailscale user" disabled={busy} onChange={event => setLogin(event.target.value)} /><Button variant="outline" disabled={busy || !status} onClick={() => { void save(status!.enabled) }}>保存</Button></div></SettingsField>
    </SettingsCard>
    <div className="space-y-2 text-sm text-muted-foreground"><p>启用后，在电脑终端运行：</p><pre className="material-control rounded-lg px-4 py-3 text-xs">tailscale serve --bg 43127</pre><p>保持 KklyeeNook 和 Tailscale 运行，然后在手机上打开 Remote URL。</p></div>
    {(error || status?.error) && <p role="alert" className="text-sm text-destructive">{error || status?.error}</p>}
    <Button variant="ghost" disabled={busy} onClick={async () => { try { setStatus(await window.api.remote.status()); setError('') } catch (error) { setError((error as Error).message) } }}><RefreshCwIcon />刷新状态</Button>
  </div>
}
