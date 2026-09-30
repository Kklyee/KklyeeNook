import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
} from 'lucide-react'

import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import type { McpServerConfig, McpServerState } from '@/shared/mcp/mcpServer'
import { Button } from '@/renderer/src/components/ui/button'
import { Input } from '@/renderer/src/components/ui/input'

export function McpSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  const [states, setStates] = useState<McpServerState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyServerId, setBusyServerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState<string[]>([])
  const [env, setEnv] = useState<Array<[string, string]>>([])
  const [cwd, setCwd] = useState('')
  const [enabled, setEnabled] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setStates(await window.api.listMcpServers())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'MCP 状态读取失败，请重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const openNewServer = () => {
    setEditingId(null)
    setName('')
    setCommand('')
    setArgs([])
    setEnv([])
    setCwd('')
    setError(null)
    setEnabled(true)
    setFormOpen(true)
  }

  const openEditServer = (server: McpServerConfig) => {
    setEditingId(server.id)
    setName(server.name)
    setCommand(server.command)
    setArgs([...server.args])
    setEnv(Object.entries(server.env ?? {}))
    setCwd(server.cwd ?? '')
    setError(null)
    setEnabled(server.enabled)
    setFormOpen(true)
  }

  const saveServers = async (servers: McpServerConfig[]) => {
    await window.api.updateAgentSettings({ cwd: settings.cwd, mcpServers: servers })
    await onChanged()
    await refresh()
  }

  const saveServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const keys = env.map(([key]) => key.trim())
    if (
      keys.some((key) => !key || key.includes('=') || key.includes('\0')) ||
      new Set(keys).size !== keys.length
    ) {
      setError('环境变量名称不能为空、重复或包含等号。')
      return
    }
    const server: McpServerConfig = {
      id: editingId ?? crypto.randomUUID(),
      name: name.trim(),
      enabled,
      transport: 'stdio',
      command: command.trim(),
      args,
      ...(env.length
        ? {
            env: Object.fromEntries(env.map(([key, value]) => [key.trim(), value])),
          }
        : {}),
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
    }
    const current = settings.mcpServers ?? []
    const next = editingId
      ? current.map((item) => (item.id === editingId ? server : item))
      : [...current, server]

    setSaving(true)
    setError(null)
    try {
      await saveServers(next)
      setFormOpen(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'MCP Server 保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  const toggleServer = async (server: McpServerConfig) => {
    setBusyServerId(server.id)
    setError(null)
    try {
      await saveServers(
        (settings.mcpServers ?? []).map((item) =>
          item.id === server.id ? { ...item, enabled: !item.enabled } : item,
        ),
      )
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'MCP Server 状态更新失败。')
    } finally {
      setBusyServerId(null)
    }
  }

  const removeServer = async (serverId: string) => {
    setBusyServerId(serverId)
    setError(null)
    try {
      await saveServers((settings.mcpServers ?? []).filter((server) => server.id !== serverId))
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'MCP Server 删除失败。')
    } finally {
      setBusyServerId(null)
    }
  }

  const retryServer = async (serverId: string) => {
    setBusyServerId(serverId)
    setError(null)
    try {
      await window.api.retryMcpServer(serverId)
      await refresh()
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'MCP Server 重试失败。')
    } finally {
      setBusyServerId(null)
    }
  }

  const stateByServerId = new Map(states.map((state) => [state.serverId, state]))

  if (formOpen) {
    const fieldClass = 'space-y-3 p-5'
    return (
      <section aria-labelledby="mcp-form-title" className="space-y-5">
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground -ml-3"
          disabled={saving}
          onClick={() => setFormOpen(false)}
        >
          <ArrowLeftIcon />
          返回
        </Button>
        <div className="space-y-2 pb-2">
          <h2 id="mcp-form-title" className="text-xl font-semibold">
            {editingId ? '编辑 MCP 服务器' : '连接至自定义 MCP'}
          </h2>
          <a
            href="https://ts.sdk.modelcontextprotocol.io/v2/"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:text-foreground"
          >
            文档 <ExternalLinkIcon className="size-3.5" />
          </a>
        </div>
        <form className="space-y-3" onSubmit={(event) => void saveServer(event)}>
          <fieldset disabled={saving} className="space-y-3">
            <div className="glass-surface divide-y divide-glass-border-subtle overflow-hidden rounded-2xl">
              <label className={`block ${fieldClass}`}>
                <span className="text-sm font-medium">名称</span>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="MCP server name"
                  required
                  className="h-11 rounded-xl"
                />
              </label>
              <div className="flex items-center justify-between px-5 py-4">
                <span className="text-sm font-medium">类型</span>
                <span className="bg-surface-raised rounded-lg px-3 py-1.5 text-sm">STDIO</span>
              </div>
            </div>
            <div className="glass-surface divide-y divide-glass-border-subtle overflow-hidden rounded-2xl">
              <label className={`block ${fieldClass}`}>
                <span className="text-sm font-medium">启动命令</span>
                <Input
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="npx"
                  required
                  className="h-11 rounded-xl"
                />
                <p className="text-muted-foreground text-xs">
                  填写可执行文件名或完整路径，命令参数在下方逐项添加。
                </p>
              </label>
              <div className={fieldClass}>
                <p className="text-sm font-medium">参数</p>
                {args.map((arg, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      aria-label={`参数 ${index + 1}`}
                      value={arg}
                      onChange={(event) =>
                        setArgs(args.map((value, i) => (i === index ? event.target.value : value)))
                      }
                      className="h-11 rounded-xl"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除参数 ${index + 1}`}
                      onClick={() => setArgs(args.filter((_, i) => i !== index))}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full rounded-xl"
                  onClick={() => setArgs([...args, ''])}
                >
                  <PlusIcon />
                  添加参数
                </Button>
              </div>
              <div className={fieldClass}>
                <p className="text-sm font-medium">
                  环境变量 <span className="text-muted-foreground font-normal">（可选）</span>
                </p>
                {env.map(([key, value], index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      aria-label={`环境变量 ${index + 1} 名称`}
                      placeholder="键"
                      value={key}
                      onChange={(event) =>
                        setEnv(
                          env.map((pair, i) =>
                            i === index ? [event.target.value, pair[1]] : pair,
                          ),
                        )
                      }
                      className="h-11 min-w-0 rounded-xl"
                    />
                    <Input
                      aria-label={`环境变量 ${index + 1} 值`}
                      placeholder="值"
                      type="password"
                      autoComplete="off"
                      value={value}
                      onChange={(event) =>
                        setEnv(
                          env.map((pair, i) =>
                            i === index ? [pair[0], event.target.value] : pair,
                          ),
                        )
                      }
                      className="h-11 min-w-0 rounded-xl"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除环境变量 ${index + 1}`}
                      onClick={() => setEnv(env.filter((_, i) => i !== index))}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full rounded-xl"
                  onClick={() => setEnv([...env, ['', '']])}
                >
                  <PlusIcon />
                  添加环境变量
                </Button>
                <p className="text-muted-foreground text-xs">
                  覆盖服务器进程的变量；默认保留 PATH 等 SDK 基础环境。变量保存在本机配置中。
                </p>
              </div>
              <label className={`block ${fieldClass}`}>
                <span className="text-sm font-medium">
                  工作目录 <span className="text-muted-foreground font-normal">（可选）</span>
                </span>
                <Input
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  placeholder="使用服务器默认工作目录"
                  className="h-11 rounded-xl"
                />
                <p className="text-muted-foreground text-xs">需要指定目录时填写绝对路径。</p>
              </label>
            </div>
            <label className="flex items-center gap-2 px-1 py-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="size-4 accent-brand"
              />
              保存后启用
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setFormOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="rounded-xl"
              disabled={saving || !name.trim() || !command.trim()}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <section aria-labelledby="mcp-servers-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="mcp-servers-title" className="text-xs font-medium">
            MCP Servers
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            连接本地 stdio Server。MCP 工具首次调用时会请求审批。
          </p>
        </div>
        <Button type="button" size="sm" onClick={openNewServer}>
          <PlusIcon />
          添加 Server
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}

      {(settings.mcpServers ?? []).length === 0 ? (
        <div className="glass-surface rounded-xl border border-dashed p-8 text-center">
          <ServerIcon className="text-muted-foreground/60 mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">还没有 MCP Server</p>
          <p className="text-muted-foreground mt-1 text-xs">
            添加 stdio Server 后，Agent 会自动发现它提供的工具。
          </p>
        </div>
      ) : (
        <div className="glass-surface divide-y divide-glass-border overflow-hidden rounded-xl">
          {(settings.mcpServers ?? []).map((server) => {
            const state = stateByServerId.get(server.id)
            const status = state?.status ?? (loading && server.enabled ? 'connecting' : 'disconnected')
            const statusLabel = stateLabel(status, state?.error)
            const busy = busyServerId === server.id
            return (
              <div
                key={server.id}
                className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{server.name}</p>
                  <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                    <span className={`${statusColor(status)} max-w-[min(52vw,320px)] break-all`}>
                      {statusLabel}
                    </span>
                    {status === 'connected' && <span>· {state?.toolCount ?? 0} 个工具</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => openEditServer(server)}
                  >
                    编辑
                  </Button>
                  {server.enabled && status !== 'connected' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || status === 'connecting'}
                      onClick={() => void retryServer(server.id)}
                    >
                      {status === 'connecting' ? (
                        <RefreshCwIcon className="animate-spin" />
                      ) : (
                        '重试'
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void toggleServer(server)}
                  >
                    {server.enabled ? '停用' : '启用'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除 ${server.name}`}
                    title="删除"
                    disabled={busy}
                    onClick={() => void removeServer(server.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function stateLabel(status: McpServerState['status'] | 'connecting', error?: string): string {
  if (status === 'connected') return '已连接'
  if (status === 'connecting') return '连接中'
  if (status === 'error') return `错误 · ${error ?? '连接失败'}`
  return '已断开'
}

function statusColor(status: McpServerState['status'] | 'connecting'): string {
  if (status === 'connected') return 'text-success'
  if (status === 'connecting') return 'text-warning'
  if (status === 'error') return 'text-danger'
  return 'text-muted-foreground'
}
