import { useEffect, useState } from 'react'
import type { GroveStatus } from '@kklyeenook/shared/bot/grove-settings'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

export function GroveConnectionPanel() {
  const [status, setStatus] = useState<GroveStatus>()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const value = await window.api.grove.status()
        if (active) {
          setStatus(value)
          setUrl((current) => current || value.relayUrl)
        }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '连接状态加载失败')
      }
    }
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  const save = async (enabled: boolean) => {
    setBusy(true)
    setError('')
    try {
      const next = await window.api.grove.configure({
        enabled,
        relayUrl: url,
        userToken: token.trim() || undefined,
      })
      setStatus(next)
      setToken('')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Grove 连接失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="divide-y">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="font-medium">Grove Network</h2>
        <span className="text-xs text-muted-foreground">
          {status?.enabled ? (status.error ? '连接中断 · 等待重试' : '已启用') : '未启用'}
        </span>
      </div>
      <div className="space-y-3 px-5 py-4">
        <label className="block text-sm">
          Relay 地址
          <Input
            className="mt-2"
            aria-label="Grove Relay 地址"
            placeholder="https://grove.example.com"
            value={url}
            disabled={busy || Boolean(status?.hostId)}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          User 访问凭据
          <Input
            className="mt-2"
            aria-label="Grove User 访问凭据"
            type="password"
            autoComplete="off"
            placeholder={
              status?.hasUserCredential ? '已加密保存，留空复用' : '输入 Relay 管理员签发的凭据'
            }
            value={token}
            disabled={busy}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          首次连接会为本设备注册独立 Host。访问凭据加密保存，重新启用时复用同一身份。
        </p>
        {status?.userId && (
          <p className="break-all text-xs text-muted-foreground">
            User：{status.userId}
            <br />
            Host：{status.hostId}
          </p>
        )}
        {status && !status.credentialPersistenceAvailable && (
          <p className="text-xs text-destructive">系统加密凭据存储不可用，暂时无法启用 Grove。</p>
        )}
        {(error || status?.error) && (
          <p role="alert" className="text-xs text-destructive">
            {error || status?.error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || !url || !status?.credentialPersistenceAvailable}
            onClick={() => void save(true)}
          >
            {status?.enabled ? '保存连接' : '启用 Grove'}
          </Button>
          {status?.enabled && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void save(false)}>
              暂停网络
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
