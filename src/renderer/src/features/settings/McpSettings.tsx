import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PlusIcon, RefreshCwIcon, ServerIcon, Trash2Icon } from 'lucide-react'

import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import type { McpServerConfig, McpServerState } from '@/shared/mcp/mcpServer'
import { Button } from '@/renderer/src/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/renderer/src/components/ui/dialog'
import { Input } from '@/renderer/src/components/ui/input'
import { Textarea } from '@/renderer/src/components/ui/textarea'

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
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [argsText, setArgsText] = useState('')
  const [enabled, setEnabled] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setStates(await window.api.listMcpServers())
      setError(null)
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
    setArgsText('')
    setEnabled(true)
    setDialogOpen(true)
  }

  const openEditServer = (server: McpServerConfig) => {
    setEditingId(server.id)
    setName(server.name)
    setCommand(server.command)
    setArgsText(server.args.join('\n'))
    setEnabled(server.enabled)
    setDialogOpen(true)
  }

  const saveServers = async (servers: McpServerConfig[]) => {
    await window.api.updateAgentSettings({ cwd: settings.cwd, mcpServers: servers })
    await onChanged()
    await refresh()
  }

  const saveServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const server: McpServerConfig = {
      id: editingId ?? crypto.randomUUID(),
      name: name.trim(),
      enabled,
      transport: 'stdio',
      command: command.trim(),
      args: argsText.split(/\r?\n/).map((arg) => arg.trim()).filter(Boolean),
    }
    const current = settings.mcpServers ?? []
    const next = editingId
      ? current.map((item) => (item.id === editingId ? server : item))
      : [...current, server]

    setSaving(true)
    setError(null)
    try {
      await saveServers(next)
      setDialogOpen(false)
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-raised !bg-surface-raised max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑 MCP Server' : '添加 MCP Server'}</DialogTitle>
            <DialogDescription>配置通过 stdio 启动的本地 MCP Server。</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void saveServer(event)}>
            <label className="block space-y-1.5 text-xs font-medium">
              名称
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Filesystem"
                required
              />
            </label>
            <label className="block space-y-1.5 text-xs font-medium">
              命令
              <Input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
                required
              />
            </label>
            <label className="block space-y-1.5 text-xs font-medium">
              参数（每行一个）
              <Textarea
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
                placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/workspace'}
                rows={4}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="size-4 accent-brand"
              />
              启用
            </label>
            <div className="flex justify-end gap-2 border-t border-glass-border-subtle pt-3">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving || !name.trim() || !command.trim()}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
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
