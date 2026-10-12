import { useEffect, useState } from 'react'
import type { GroveConnections } from '@kklyeenook/shared/bot/grove-settings'
import { SOCIAL_ACTIONS, type Principal, type SocialAction } from '@kklyeenook/shared/bot/social'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, SelectTrigger, SelectContent, SelectItem } from '../../components/ui/select'

const labels: Record<SocialAction, string> = {
  'message.send': '发送消息',
  'task.request': '请求任务',
  'tool.propose': '分享能力',
  'tool.install': '安装能力',
  'tool.invoke': '调用共享工具',
}

export function GrovePermissionsPanel() {
  const [connections, setConnections] = useState<GroveConnections>()
  const [subjectType, setSubjectType] = useState<Principal['type']>('bot')
  const [subjectId, setSubjectId] = useState('')
  const [target, setTarget] = useState('')
  const [actions, setActions] = useState<SocialAction[]>([])
  const [tools, setTools] = useState('')
  const [servers, setServers] = useState('')
  const [uses, setUses] = useState('')
  const [expiry, setExpiry] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        if (!(await window.api.grove.status()).hasUserCredential) return
        const value = await window.api.grove.connections()
        if (active) setConnections(value)
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '授权列表加载失败')
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setConnections(await window.api.grove.connections())
    } catch (error) {
      setError(error instanceof Error ? error.message : '授权操作失败')
    } finally {
      setBusy(false)
    }
  }
  const ownBots = connections?.bots.filter((bot) => bot.ownerUserId === connections.userId) ?? []
  const names = (id: string) => connections?.bots.find((bot) => bot.networkId === id)?.name ?? id
  const list = (value: string) => [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ]
  return (
    <section className="px-5 py-4">
      <h2 className="font-medium">Permissions</h2>
      <p className="mt-2 text-xs text-muted-foreground">
        仅为自己的 Bot 授权。User 与 Bot 是独立主体，用户授权不会扩展到其 Bot。
      </p>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void act(async () => {
            const maxUses = uses ? Number(uses) : undefined
            const expiresAt = expiry ? new Date(expiry).getTime() : undefined
            if (maxUses !== undefined && (!Number.isSafeInteger(maxUses) || maxUses < 1))
              throw new Error('使用次数必须为正整数')
            if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.now()))
              throw new Error('到期时间必须晚于当前时间')
            const allowedToolIds = tools.trim() ? list(tools) : undefined
            const allowedMcpServers = servers.trim() ? list(servers) : undefined
            await window.api.grove.grant({
              subject: { type: subjectType, id: subjectId.trim() },
              targetBotId: target,
              actions,
              constraints: { allowedToolIds, allowedMcpServers, maxUses, expiresAt },
            })
          })
        }}
      >
        <Select value={target} onValueChange={(value) => value && setTarget(value)}>
          <SelectTrigger aria-label="授权目标 Bot">
            {target ? names(target) : '选择我的 Bot'}
          </SelectTrigger>
          <SelectContent>
            {ownBots.map((bot) => (
              <SelectItem key={bot.networkId} value={bot.networkId}>
                {bot.name} · {bot.hostId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Select
            value={subjectType}
            onValueChange={(value) => {
              if (value === 'user' || value === 'bot') setSubjectType(value)
            }}
          >
            <SelectTrigger aria-label="授权主体类型" className="w-28 shrink-0">
              {subjectType === 'bot' ? 'Bot' : 'User'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bot">Bot</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
          <Input
            aria-label="授权主体 ID"
            placeholder={subjectType === 'bot' ? '对方的 Network Bot ID' : '对方的 User ID'}
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {SOCIAL_ACTIONS.map((action) => (
            <label key={action} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={actions.includes(action)}
                onChange={(event) =>
                  setActions((current) =>
                    event.target.checked
                      ? [...current, action]
                      : current.filter((id) => id !== action),
                  )
                }
              />
              {labels[action]}
            </label>
          ))}
        </div>
        <Input
          aria-label="允许的 Tool ID"
          placeholder="允许的 Tool ID，以逗号分隔；留空不限制"
          value={tools}
          onChange={(event) => setTools(event.target.value)}
        />
        <Input
          aria-label="允许的 MCP Server ID"
          placeholder="允许的 MCP Server ID，以逗号分隔；留空不限制"
          value={servers}
          onChange={(event) => setServers(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            最多使用次数（可选）
            <Input
              type="number"
              min="1"
              step="1"
              value={uses}
              onChange={(event) => setUses(event.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            到期时间（可选）
            <Input
              type="datetime-local"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            />
          </label>
        </div>
        <Button
          size="sm"
          className="self-start"
          type="submit"
          disabled={busy || !connections || !target || !subjectId.trim() || actions.length === 0}
        >
          保存授权
        </Button>
      </form>
      <div className="mt-3 divide-y">
        {connections?.grants.map((grant) => {
          const expired =
            grant.constraints?.expiresAt !== undefined && grant.constraints.expiresAt <= Date.now()
          return (
            <div key={grant.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="break-all">
                  {grant.subject.type}：{grant.subject.id} → {names(grant.targetBotId)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {grant.actions.map((action) => labels[action]).join(' · ')}
                  {grant.revokedAt ? ' · 已撤销' : expired ? ' · 已到期' : ' · 已授权'}
                </p>
                {grant.constraints?.allowedToolIds && (
                  <p className="mt-1 break-all text-xs">
                    Tools：{grant.constraints.allowedToolIds.join(', ')}
                  </p>
                )}
                {grant.constraints?.allowedMcpServers && (
                  <p className="mt-1 break-all text-xs">
                    MCP：{grant.constraints.allowedMcpServers.join(', ')}
                  </p>
                )}
                {grant.constraints?.maxUses !== undefined && (
                  <p className="mt-1 text-xs">最多 {grant.constraints.maxUses} 次</p>
                )}
                {grant.constraints?.expiresAt !== undefined && (
                  <p className="mt-1 text-xs">
                    到期：{new Date(grant.constraints.expiresAt).toLocaleString()}
                  </p>
                )}
              </div>
              {!grant.revokedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act(() => window.api.grove.revoke(grant.id))}
                >
                  撤销
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
