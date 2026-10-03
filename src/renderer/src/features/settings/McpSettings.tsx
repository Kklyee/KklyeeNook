import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeftIcon,
  ChevronDownIcon,
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

function useMcpSettings({
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
  const [busyToolKey, setBusyToolKey] = useState<string | null>(null)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState<Array<{ id: string; value: string }>>([])
  const [env, setEnv] = useState<Array<{ id: string; key: string; value: string }>>([])
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
    setArgs(server.args.map((value) => ({ id: crypto.randomUUID(), value })))
    setEnv(
      Object.entries(server.env ?? {}).map(([key, value]) => ({
        id: crypto.randomUUID(),
        key,
        value,
      })),
    )
    setCwd(server.cwd ?? '')
    setError(null)
    setEnabled(server.enabled)
    setFormOpen(true)
  }

  const saveServers = async (servers: McpServerConfig[]) => {
    await window.api.updateAgentSettings({ mcpServers: servers })
    await onChanged()
    await refresh()
  }

  const saveServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const keys = env.map(({ key }) => key.trim())
    if (
      keys.some((key) => !key || key.includes('=') || key.includes('\0')) ||
      new Set(keys).size !== keys.length
    ) {
      setError('环境变量名称不能为空、重复或包含等号。')
      return
    }
    const existing = (settings.mcpServers ?? []).find((item) => item.id === editingId)
    const server: McpServerConfig = {
      id: editingId ?? crypto.randomUUID(),
      name: name.trim(),
      enabled,
      transport: 'stdio',
      command: command.trim(),
      args: args.map(({ value }) => value),
      ...(env.length
        ? {
            env: Object.fromEntries(env.map(({ key, value }) => [key.trim(), value])),
          }
        : {}),
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(existing?.disabledTools ? { disabledTools: existing.disabledTools } : {}),
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

  const toggleTool = async (server: McpServerConfig, toolName: string, enabled: boolean) => {
    const key = `${server.id}:${toolName}`
    setBusyToolKey(key)
    setError(null)
    try {
      const disabledTools = new Set(server.disabledTools ?? [])
      if (enabled) disabledTools.delete(toolName)
      else disabledTools.add(toolName)
      await saveServers(
        (settings.mcpServers ?? []).map((item) =>
          item.id === server.id ? { ...item, disabledTools: [...disabledTools] } : item,
        ),
      )
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'MCP 工具状态更新失败。')
    } finally {
      setBusyToolKey(null)
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

  return {
    states,
    loading,
    saving,
    busyServerId,
    busyToolKey,
    expandedServers,
    setExpandedServers,
    error,
    formOpen,
    setFormOpen,
    editingId,
    name,
    setName,
    command,
    setCommand,
    args,
    setArgs,
    env,
    setEnv,
    cwd,
    setCwd,
    enabled,
    setEnabled,
    openNewServer,
    openEditServer,
    saveServer,
    toggleServer,
    toggleTool,
    removeServer,
    retryServer,
    stateByServerId,
  }
}

export function McpSettings(props: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  const model = useMcpSettings(props)
  if (model.formOpen) return <McpServerForm model={model} />
  return <McpServerList model={model} settings={props.settings} />
}

function McpServerForm({ model }: { model: ReturnType<typeof useMcpSettings> }) {
  const {
    saving,
    error,
    setFormOpen,
    editingId,
    name,
    setName,
    command,
    setCommand,
    args,
    setArgs,
    env,
    setEnv,
    cwd,
    setCwd,
    enabled,
    setEnabled,
    saveServer,
  } = model
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
          <div className="material-control divide-y divide-border overflow-hidden rounded-2xl">
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
          <div className="material-control divide-y divide-border overflow-hidden rounded-2xl">
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
                <div key={arg.id} className="flex items-center gap-2">
                  <Input
                    aria-label={`参数 ${index + 1}`}
                    value={arg.value}
                    onChange={(event) =>
                      setArgs(
                        args.map((row) =>
                          row.id === arg.id ? { ...row, value: event.target.value } : row,
                        ),
                      )
                    }
                    className="h-11 rounded-xl"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除参数 ${index + 1}`}
                    onClick={() => setArgs(args.filter((row) => row.id !== arg.id))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="w-full rounded-xl"
                onClick={() => setArgs([...args, { id: crypto.randomUUID(), value: '' }])}
              >
                <PlusIcon />
                添加参数
              </Button>
            </div>
            <div className={fieldClass}>
              <p className="text-sm font-medium">
                环境变量 <span className="text-muted-foreground font-normal">（可选）</span>
              </p>
              {env.map((row, index) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Input
                    aria-label={`环境变量 ${index + 1} 名称`}
                    placeholder="键"
                    value={row.key}
                    onChange={(event) =>
                      setEnv(
                        env.map((pair) =>
                          pair.id === row.id ? { ...pair, key: event.target.value } : pair,
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
                    value={row.value}
                    onChange={(event) =>
                      setEnv(
                        env.map((pair) =>
                          pair.id === row.id ? { ...pair, value: event.target.value } : pair,
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
                    onClick={() => setEnv(env.filter((pair) => pair.id !== row.id))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="w-full rounded-xl"
                onClick={() => setEnv([...env, { id: crypto.randomUUID(), key: '', value: '' }])}
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

function McpServerList({
  model,
  settings,
}: {
  model: ReturnType<typeof useMcpSettings>
  settings: AgentSettingsSnapshot
}) {
  const {
    loading,
    busyServerId,
    busyToolKey,
    expandedServers,
    setExpandedServers,
    error,
    openNewServer,
    openEditServer,
    toggleServer,
    toggleTool,
    removeServer,
    retryServer,
    stateByServerId,
  } = model

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
        <div className="material-control rounded-xl border-dashed p-8 text-center">
          <ServerIcon className="text-muted-foreground/60 mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">还没有 MCP Server</p>
          <p className="text-muted-foreground mt-1 text-xs">
            添加 stdio Server 后，Agent 会自动发现它提供的工具。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {(settings.mcpServers ?? []).map((server) => {
            const state = stateByServerId.get(server.id)
            const status =
              state?.status ?? (loading && server.enabled ? 'connecting' : 'disconnected')
            const statusLabel = stateLabel(status, state?.error)
            const busy = busyServerId === server.id
            const expanded = expandedServers.has(server.id)
            const tools = state?.tools ?? []
            const enabledToolCount = tools.filter((tool) => tool.enabled).length
            const configBusy = busy || busyToolKey !== null
            return (
              <div key={server.id} className="material-control overflow-hidden rounded-xl">
                <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{server.name}</p>
                    <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                      <span className={`${statusColor(status)} max-w-[min(52vw,320px)] break-all`}>
                        {statusLabel}
                      </span>
                      {status === 'connected' && (
                        <span>
                          · {enabledToolCount}/{state?.toolCount ?? 0} 个工具已启用
                        </span>
                      )}
                    </div>
                    {status === 'connected' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground mt-1 -ml-3 h-7"
                        aria-expanded={expanded}
                        onClick={() =>
                          setExpandedServers((current) => {
                            const next = new Set(current)
                            if (next.has(server.id)) next.delete(server.id)
                            else next.add(server.id)
                            return next
                          })
                        }
                      >
                        <ChevronDownIcon
                          className={
                            expanded ? 'rotate-180 transition-transform' : 'transition-transform'
                          }
                        />
                        {expanded ? '收起工具' : '查看工具'}
                      </Button>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={configBusy}
                      onClick={() => openEditServer(server)}
                    >
                      编辑
                    </Button>
                    {server.enabled && status !== 'connected' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={configBusy || status === 'connecting'}
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
                      disabled={configBusy}
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
                      disabled={configBusy}
                      onClick={() => void removeServer(server.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
                {expanded && status === 'connected' && (
                  <div className="divide-y divide-border border-t border-border px-4">
                    {tools.map((tool) => (
                      <div key={tool.name} className="flex items-start justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p className="break-all text-sm font-medium">{tool.name}</p>
                          <p className="text-muted-foreground mt-1 whitespace-pre-wrap break-words text-xs">
                            {tool.description || '此工具没有提供描述。'}
                          </p>
                        </div>
                        <label className="flex shrink-0 items-center gap-2 pt-0.5 text-xs">
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`启用 ${tool.name}`}
                            checked={tool.enabled}
                            disabled={configBusy}
                            onChange={(event) =>
                              void toggleTool(server, tool.name, event.target.checked)
                            }
                            className="peer sr-only"
                          />
                          <span
                            className={`relative h-5 w-9 rounded-full transition-colors ${tool.enabled ? 'bg-brand' : 'bg-muted'} peer-focus-visible:ring-2 peer-focus-visible:ring-ring`}
                          >
                            <span
                              className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform ${tool.enabled ? 'translate-x-4' : ''}`}
                            />
                          </span>
                          {tool.enabled ? '启用' : '停用'}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
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
