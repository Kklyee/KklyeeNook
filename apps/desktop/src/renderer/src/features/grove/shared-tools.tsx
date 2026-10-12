import { useEffect, useState } from 'react'
import type { SharedMcp, SharedToolsSnapshot } from '@kklyeenook/shared/bot/capabilities'
import type { GroveConnections } from '@kklyeenook/shared/bot/grove-settings'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, SelectTrigger, SelectContent, SelectItem } from '../../components/ui/select'

const states = {
  pending: '待接收',
  awaiting_approval: '等待所有者确认',
  installing: '安装中',
  completed: '已完成',
  failed: '失败',
  rejected: '已拒绝',
}

export function GroveSharedToolsPanel() {
  const [snapshot, setSnapshot] = useState<SharedToolsSnapshot>()
  const [connections, setConnections] = useState<GroveConnections>()
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [requiresCredentials, setRequiresCredentials] = useState(false)
  const [shared, setShared] = useState(true)
  const [credential, setCredential] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const refresh = async () => {
    const [next, contacts] = await Promise.all([
      window.api.grove.sharedTools(),
      window.api.grove.connections(),
    ])
    setSnapshot(next)
    setConnections(contacts)
  }
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        if (!(await window.api.grove.status()).hasUserCredential) return
        const [next, contacts] = await Promise.all([
          window.api.grove.sharedTools(),
          window.api.grove.connections(),
        ])
        if (active) {
          setSnapshot(next)
          setConnections(contacts)
        }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '共享能力读取失败')
      }
    }
    void load()
    const timer = setInterval(() => void load(), 3000)
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
      await refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : '能力操作失败')
    } finally {
      setBusy(false)
    }
  }
  const server: SharedMcp = {
    id: id.trim(),
    name: name.trim(),
    url: url.trim(),
    requiresCredentials,
  }
  const names = (botId: string) =>
    connections?.bots.find((bot) => bot.networkId === botId)?.name ?? botId
  const change = (update: () => void) => {
    update()
    setOperationId(crypto.randomUUID())
  }
  return (
    <section className="px-5 py-4">
      <h2 className="font-medium">Shared Tools · MCP Servers</h2>
      <p className="mt-2 text-xs text-muted-foreground">
        分享 HTTPS 连接定义。授权安装仅使用目标 Host
        的公开目录；新能力作为提案等待所有者确认。凭据只由目标所有者配置。
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <Input
          aria-label="MCP Server ID"
          placeholder="MCP Server ID"
          value={id}
          onChange={(event) => change(() => setId(event.target.value))}
        />
        <Input
          aria-label="MCP 名称"
          placeholder="名称"
          value={name}
          onChange={(event) => change(() => setName(event.target.value))}
        />
        <Input
          aria-label="MCP URL"
          placeholder="https://example.com/mcp"
          value={url}
          onChange={(event) => change(() => setUrl(event.target.value))}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiresCredentials}
            onChange={(event) => change(() => setRequiresCredentials(event.target.checked))}
          />
          接收方需要私人凭据
        </label>
        {requiresCredentials && (
          <Input
            aria-label="本机 MCP 凭据"
            type="password"
            autoComplete="off"
            placeholder="本机凭据（可选，仅加密保存于本机）"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
          在本机目录公开此 MCP（关闭后停止后续授权安装与远程调用）
        </label>
        <Select value={target} onValueChange={(value) => value && change(() => setTarget(value))}>
          <SelectTrigger aria-label="能力接收 Bot">
            {target ? names(target) : '选择接收 Bot'}
          </SelectTrigger>
          <SelectContent>
            {connections?.bots.map((bot) => (
              <SelectItem key={bot.networkId} value={bot.networkId}>
                {bot.name} · {bot.ownerUserId === connections.userId ? '我的 Bot' : bot.ownerUserId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || !id.trim() || !name.trim() || !url.trim()}
            onClick={() =>
              void act(async () => {
                  await window.api.grove.configureMcp({ server, credential: credential || undefined, shared })
                setCredential('')
              })
            }
          >
            保存到本机共享目录
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !snapshot || !target || !id.trim() || !name.trim() || !url.trim()}
            onClick={() =>
              void act(async () => {
                await window.api.grove.requestCapability({
                  operationId,
                  targetBotId: target,
                  action: 'tool.propose',
                  server,
                })
                setOperationId(crypto.randomUUID())
              })
            }
          >
            分享提案
          </Button>
        </div>
      </div>
      <div className="mt-3 divide-y">
        {snapshot?.catalog.flatMap((entry) =>
          entry.servers.map((server) => (
            <div
              key={`${entry.botId}:${server.id}`}
              className="flex flex-wrap items-center gap-3 py-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p>
                  {names(entry.botId)} · {server.name}
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  Bot：{entry.botId} · {server.id} · {server.url}
                  {server.requiresCredentials ? ' · 需要所有者凭据' : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    window.api.grove.requestCapability({
                      operationId: `install:${entry.botId}:${server.id}:${operationId}`,
                      targetBotId: entry.botId,
                      action: 'tool.install',
                      server,
                    }),
                  )
                }
              >
                授权安装
              </Button>
            </div>
          )),
        )}
      </div>
      <div className="mt-3 divide-y">
        {snapshot?.local
          .filter((entry) => entry.operation.state === 'awaiting_approval')
          .map((entry) => (
            <div key={entry.operation.id} className="py-3 text-sm">
              <p>
                {names(entry.operation.targetBotId)} · {entry.server.name} · 等待本机所有者确认
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                来自 {entry.operation.subject.type}：{entry.operation.subject.id} ·{' '}
                {entry.server.url}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      window.api.grove.decideCapability({ id: entry.operation.id, approved: true }),
                    )
                  }
                >
                  同意安装
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      window.api.grove.decideCapability({
                        id: entry.operation.id,
                        approved: false,
                      }),
                    )
                  }
                >
                  拒绝
                </Button>
                {entry.server.requiresCredentials && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setId(entry.server.id)
                      setName(entry.server.name)
                      setUrl(entry.server.url)
                      setRequiresCredentials(true)
                    }}
                  >
                    配置本机凭据
                  </Button>
                )}
              </div>
            </div>
          ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer">能力管理活动</summary>
        <div className="divide-y">
          {snapshot?.operations.map((entry) => (
            <div key={entry.operation.id} className="py-3">
              <p>
                {names(entry.operation.targetBotId)} · {entry.server.name} ·{' '}
                {states[entry.operation.state]}
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {entry.operation.subject.type}：{entry.operation.subject.id} · Grant：
                {entry.operation.grantId} · {new Date(entry.operation.updatedAt).toLocaleString()}
              </p>
              {entry.operation.error && (
                <p className="mt-1 text-xs text-destructive">{entry.operation.error}</p>
              )}
            </div>
          ))}
        </div>
      </details>
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
