import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import {
  ArrowLeftIcon,
  BotIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  PlusIcon,
  WrenchIcon,
} from 'lucide-react'
import type {
  AgentSettingsSnapshot,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import {
  modelConfigId,
  type SavedModelConfig,
  type ThinkingLevel,
} from '@/shared/agent/agentConfig'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'

const toolDescriptions: Record<string, string> = {
  read: '读取文件',
  edit: '编辑文件',
  write: '写入文件',
  bash: '执行命令',
}

type SettingsTab = 'model' | 'tools' | 'permissions'

const settingsTabs: Array<{
  id: SettingsTab
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: 'model', label: '模型配置', description: '模型与工作目录', icon: BotIcon },
  { id: 'tools', label: '工具', description: '可用工具与审批方式', icon: WrenchIcon },
  { id: 'permissions', label: '权限管理', description: '查看和撤销授权', icon: ShieldCheckIcon },
]

export function SettingsPage({
  settings,
  error,
  initialTab = 'model',
  onClose,
  onChanged,
}: {
  settings: AgentSettingsSnapshot | null
  error: string | null
  initialTab?: SettingsTab
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [search, setSearch] = useState('')
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const permissionGrants = Array.isArray(settings?.permissionGrants)
    ? settings.permissionGrants
    : []
  const visibleTabs = settingsTabs.filter(({ label, description }) =>
    `${label}${description}`.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const activeTab = settingsTabs.find((item) => item.id === tab) ?? settingsTabs[0]

  const revoke = async (id: string) => {
    setRevoking(id)
    setRevokeError(null)
    try {
      await window.api.deletePermissionGrant({ id })
      await onChanged()
    } catch {
      setRevokeError('权限撤销失败，请重试。')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <section
      className="bg-background flex h-full min-h-0 w-full flex-col md:flex-row"
      aria-label="设置"
    >
      <aside className="bg-sidebar text-sidebar-foreground flex w-full shrink-0 flex-col border-b md:h-full md:w-60 md:border-r md:border-b-0">
        <div className="px-3 pt-3 pb-2">
          <Button
            variant="ghost"
            className="h-8 justify-start gap-2 px-2 text-xs font-normal"
            onClick={onClose}
          >
            <ArrowLeftIcon className="size-3.5" />
            返回应用
          </Button>
        </div>

        <div className="px-3 pb-3">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索设置…"
              aria-label="搜索设置"
              className="bg-foreground/[0.04] h-8 border-transparent pl-8 text-xs shadow-none focus-visible:bg-background"
            />
          </div>
        </div>

        <nav aria-label="设置分类" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] font-medium">AGENT</p>
          <div className="space-y-0.5">
            {visibleTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? 'page' : undefined}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  tab === id
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                )}
                onClick={() => setTab(id)}
              >
                <Icon className="size-3.5 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          {visibleTabs.length === 0 && (
            <p className="text-muted-foreground px-2 py-4 text-xs">没有匹配的设置</p>
          )}
        </nav>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-14 lg:py-16">
          <header className="mb-8">
            <p className="text-muted-foreground mb-2 text-xs">设置</p>
            <h1 className="text-xl font-semibold tracking-tight">{activeTab.label}</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">{activeTab.description}</p>
          </header>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : !settings ? (
            <p role="status" className="text-muted-foreground text-sm">
              正在读取配置…
            </p>
          ) : tab === 'model' ? (
            <ModelSettings settings={settings} onChanged={onChanged} />
          ) : tab === 'tools' ? (
            <ToolSettings settings={settings} />
          ) : (
            <PermissionSettings
              settings={settings}
              permissionGrants={permissionGrants}
              revoking={revoking}
              revokeError={revokeError}
              onRevoke={revoke}
            />
          )}
        </div>
      </main>
    </section>
  )
}

function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="bg-card divide-y overflow-hidden rounded-xl border">{children}</div>
}

function SettingRow({
  label,
  description,
  value,
}: {
  label: string
  description: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
      </div>
      <span className="text-muted-foreground max-w-full shrink-0 break-all text-xs sm:max-w-[55%] sm:text-right">
        {value}
      </span>
    </div>
  )
}

function ModelSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  const firstProvider = settings.catalog?.[0]
  const [models, setModels] = useState(() => settings.models ?? [])
  const [activeModelId, setActiveModelId] = useState(settings.activeModelId)
  const [cwd, setCwd] = useState(settings.cwd)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [provider, setProvider] = useState(firstProvider?.id ?? '')
  const [modelID, setModelID] = useState(firstProvider?.models[0]?.id ?? '')
  const [baseUrl, setBaseUrl] = useState('')
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium')
  const [apiKey, setApiKey] = useState('')
  const [deleteApiKey, setDeleteApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setModels(settings.models ?? [])
    setActiveModelId(settings.activeModelId)
    setCwd(settings.cwd)
  }, [settings])

  const providerEntry = settings.catalog?.find((item) => item.id === provider)
  const selectedProviderHasKey = settings.models?.some(
    (item) => item.provider === provider && item.hasApiKey,
  )
  const resetEditor = () => {
    const initialProvider = settings.catalog?.[0]
    setEditingId(null)
    setProvider(initialProvider?.id ?? '')
    setModelID(initialProvider?.models[0]?.id ?? '')
    setBaseUrl('')
    setThinkingLevel('medium')
    setApiKey('')
    setDeleteApiKey(false)
  }
  const edit = (model: SavedModelConfig) => {
    setEditingId(model.id)
    setProvider(model.provider)
    setModelID(model.modelID)
    setBaseUrl(model.baseUrl ?? '')
    setThinkingLevel(model.thinkingLevel ?? 'medium')
    setApiKey('')
    setDeleteApiKey(false)
    setSaved(false)
  }
  const persist = async (
    nextModels: SavedModelConfig[],
    nextActiveModelId: string,
    credential?: UpdateAgentSettingsRequest['credential'],
  ) => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      await window.api.updateAgentSettings({
        models: nextModels,
        activeModelId: nextActiveModelId,
        cwd,
        credential,
      })
      await onChanged()
      setSaved(true)
      resetEditor()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '设置保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }
  const chooseWorkspace = async () => {
    const selected = await window.api.selectAgentWorkspace()
    if (selected) {
      setCwd(selected)
      setSaved(false)
    }
  }
  const saveModel = async () => {
    if (!provider || !modelID) return
    const next: SavedModelConfig = {
      id: modelConfigId(provider, modelID),
      provider,
      modelID,
      thinkingLevel,
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
    }
    const duplicate = models.some((item) => item.id === next.id && item.id !== editingId)
    if (duplicate) {
      setSaveError('这个模型已经添加过了。')
      return
    }
    const nextModels = editingId
      ? models.map((item) => (item.id === editingId ? next : item))
      : [...models, next]
    const nextActive = models.length === 0 || activeModelId === editingId ? next.id : activeModelId
    await persist(nextModels, nextActive, {
      provider,
      ...(apiKey.trim() ? { apiKey } : {}),
      ...(deleteApiKey ? { deleteApiKey: true } : {}),
    })
  }

  return (
    <section aria-labelledby="model-section-title">
      <h2 id="model-section-title" className="mb-3 text-xs font-medium">
        已保存的模型
      </h2>
      <SettingsCard>
        {models.map((model) => {
          const details = settings.models?.find((item) => item.id === model.id)
          return (
            <div key={model.id} className="flex items-center gap-3 px-4 py-3.5">
              <input
                type="radio"
                name="default-model"
                aria-label={`设为默认模型 ${details?.modelName ?? model.modelID}`}
                checked={activeModelId === model.id}
                onChange={() => void persist(models, model.id)}
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => edit(model)}
              >
                <p className="truncate text-sm font-medium">
                  {details?.modelName ?? model.modelID}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {details?.providerName ?? model.provider} ·{' '}
                  {details?.hasApiKey ? 'API Key 已配置' : '缺少 API Key'}
                </p>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="删除模型配置"
                disabled={models.length === 1 || saving}
                onClick={() => {
                  const next = models.filter((item) => item.id !== model.id)
                  const nextActive = activeModelId === model.id ? next[0].id : activeModelId
                  void persist(next, nextActive)
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
          )
        })}
      </SettingsCard>

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium">{editingId ? '编辑模型配置' : '添加模型配置'}</h2>
        {editingId && (
          <Button type="button" variant="ghost" size="sm" onClick={resetEditor}>
            <PlusIcon className="size-3.5" /> 新增
          </Button>
        )}
      </div>
      <SettingsCard>
        <SettingsField label="模型服务商" description="来自 pi-ai 的内置服务商">
          <select
            aria-label="模型服务商"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={provider}
            onChange={(event) => {
              const nextProvider = settings.catalog.find((item) => item.id === event.target.value)
              setProvider(event.target.value)
              setModelID(nextProvider?.models[0]?.id ?? '')
              setBaseUrl('')
              setApiKey('')
              setDeleteApiKey(false)
              setSaved(false)
            }}
          >
            {settings.catalog?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </SettingsField>
        <SettingsField label="模型" description="根据服务商列出 pi-ai 内置模型">
          <select
            aria-label="模型"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={modelID}
            onChange={(event) => {
              setModelID(event.target.value)
              setSaved(false)
            }}
          >
            {providerEntry?.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </SettingsField>
        <SettingsField label="Base URL" description="留空时使用供应商默认地址">
          <Input
            aria-label="Base URL"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value)
              setSaved(false)
            }}
            placeholder="https://api.example.com/v1"
          />
        </SettingsField>
        <SettingsField label="思考级别" description="模型的推理强度">
          <select
            aria-label="思考级别"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={thinkingLevel}
            onChange={(event) => setThinkingLevel(event.target.value as ThinkingLevel)}
          >
            {['off', 'low', 'medium', 'high'].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </SettingsField>
        <SettingsField label="API Key" description="密钥不会返回到渲染进程">
          <div className="flex gap-2">
            <Input
              aria-label="API Key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                setDeleteApiKey(false)
              }}
              placeholder={selectedProviderHasKey ? '已配置；留空表示不修改' : '输入 API Key'}
            />
            {selectedProviderHasKey && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setApiKey('')
                  setDeleteApiKey(true)
                }}
              >
                清除
              </Button>
            )}
          </div>
        </SettingsField>
        <div className="flex justify-end px-4 py-3.5">
          <Button
            type="button"
            disabled={saving || !provider || !modelID}
            onClick={() => void saveModel()}
          >
            {saving ? '保存中…' : editingId ? '更新配置' : '添加模型'}
          </Button>
        </div>
      </SettingsCard>

      <h2 className="mt-8 mb-3 text-xs font-medium">工作区</h2>
      <SettingsCard>
        <SettingsField label="工作目录" description="工具和 Artifact 的安全根目录">
          <div className="flex gap-2">
            <Input
              aria-label="工作目录"
              value={cwd}
              onChange={(event) => {
                setCwd(event.target.value)
                setSaved(false)
              }}
            />
            <Button type="button" variant="outline" onClick={() => void chooseWorkspace()}>
              选择
            </Button>
          </div>
        </SettingsField>
        <div className="flex justify-end px-4 py-3.5">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => void persist(models, activeModelId)}
          >
            保存工作目录
          </Button>
        </div>
      </SettingsCard>
      {!settings.credentialPersistenceAvailable && (
        <p className="text-amber-600 mt-3 text-xs" role="status">
          当前系统密钥存储不可用，API Key 只能保留到本次应用退出。
        </p>
      )}
      {deleteApiKey && <p className="text-amber-600 mt-3 text-xs">保存后将清除 API Key。</p>}
      {saveError && (
        <p className="text-destructive mt-3 text-sm" role="alert">
          {saveError}
        </p>
      )}
      {saved && (
        <p className="text-emerald-600 mt-3 text-sm" role="status">
          设置已保存并生效。
        </p>
      )}
    </section>
  )
}

function SettingsField({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(240px,1.2fr)] sm:items-center sm:gap-6">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
      </div>
      {children}
    </div>
  )
}

function ToolSettings({ settings }: { settings: AgentSettingsSnapshot }) {
  return (
    <section aria-labelledby="tools-section-title">
      <h2 id="tools-section-title" className="mb-3 text-xs font-medium">
        已启用的工具
      </h2>
      <SettingsCard>
        {settings.tools.map((tool) => (
          <SettingRow
            key={tool.name}
            label={toolDescriptions[tool.name] ?? tool.name}
            description={tool.name}
            value={tool.requiresApproval ? '按权限策略' : '无需审批'}
          />
        ))}
      </SettingsCard>
      <p className="text-muted-foreground mt-4 text-xs">
        受保护的工具在没有匹配 Permission Grant 时会请求审批。
      </p>
    </section>
  )
}

function PermissionSettings({
  settings,
  permissionGrants,
  revoking,
  revokeError,
  onRevoke,
}: {
  settings: AgentSettingsSnapshot
  permissionGrants: AgentSettingsSnapshot['permissionGrants']
  revoking: string | null
  revokeError: string | null
  onRevoke: (id: string) => Promise<void>
}) {
  return (
    <>
      <section aria-labelledby="default-permission-policy">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 id="default-permission-policy" className="text-xs font-medium">
            默认策略
          </h2>
          <span className="text-muted-foreground text-xs">
            {settings.tools.filter((tool) => tool.requiresApproval).length} 个受保护工具
          </span>
        </div>
        <SettingsCard>
          {settings.tools.map((tool) => (
            <SettingRow
              key={tool.name}
              label={toolDescriptions[tool.name] ?? tool.name}
              description={tool.name}
              value={tool.requiresApproval ? '未授权时询问' : '直接允许'}
            />
          ))}
        </SettingsCard>
      </section>

      <div className="bg-foreground/[0.025] mt-5 flex items-start gap-3 rounded-xl border p-4">
        <ShieldCheckIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p className="text-muted-foreground text-xs leading-relaxed">
          Session 权限只匹配对应 Agent Session；Always 权限跨 Session
          生效。撤销后，下一次匹配调用会重新询问。
        </p>
      </div>

      <div className="mt-8 mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xs font-medium">已保存的 Grant</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            在审批卡中选择 This session 或 Always 后会显示在这里。
          </p>
        </div>
        <span className="text-muted-foreground text-xs">{permissionGrants.length} 条</span>
      </div>
      {revokeError && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {revokeError}
        </p>
      )}
      {permissionGrants.length === 0 ? (
        <div className="rounded-xl border border-dashed px-5 py-9 text-center">
          <ShieldCheckIcon className="text-muted-foreground/60 mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">尚无已保存的权限</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-xs leading-relaxed">
            返回对话并触发读取、写入或命令工具；审批出现时选择 This session 或
            Always，即可创建第一条 Grant。
          </p>
        </div>
      ) : (
        <SettingsCard>
          {permissionGrants.map((grant) => (
            <div key={grant.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{grant.permission.description}</span>
                  <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-[10px] uppercase">
                    {grant.duration}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 break-all font-mono text-xs">
                  {grant.permission.action} · {grant.permission.resource}
                </p>
                {grant.sessionId && (
                  <p className="text-muted-foreground mt-1 truncate text-[11px]">
                    Session: {grant.sessionId}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="撤销权限"
                title="撤销权限"
                disabled={revoking === grant.id}
                onClick={() => void onRevoke(grant.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </SettingsCard>
      )}
    </>
  )
}
