import { useWorkspaces, notifyWorkspaceChanged } from '../workspaces/WorkspaceProvider'
import { PERMISSION_LABELS, PERMISSION_MODES, type PermissionMode } from '@/shared/approval/permission'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/select'
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import {
  ArrowLeftIcon,
  BookOpenIcon,
  BrainIcon,
  BotIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  Trash2Icon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
} from 'lucide-react'
import type { AgentSkill } from '@/shared/agent/agentSkill'
import type { AgentMemory } from '@/shared/memory/agentMemory'
import type {
  AgentSettingsSnapshot,
  ModelCatalogModel,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import {
  DEFAULT_AGENT_COMPACTION_SETTINGS,
  type AgentCompactionSettings,
  type ProviderConfig,
  type ProviderModelConfig,
} from '@/shared/agent/agentConfig'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'
import { McpSettings } from './McpSettings'
import { KnowledgeSettings } from './KnowledgeSettings'

const toolDescriptions: Record<string, string> = {
  read: '读取文件',
  edit: '编辑文件',
  write: '写入文件',
  bash: '执行命令',
  update_plan: '更新计划',
  save_memory: '保存 Memory',
  delegate_task: '委派子任务',
  search_knowledge: '检索 Knowledge',
  read_knowledge: '读取 Knowledge',
}

type SettingsTab = 'model' | 'permissions' | 'skills' | 'memory' | 'mcp' | 'knowledge'

const settingsTabs: Array<{
  id: SettingsTab
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
}> = [
  {
    id: 'model',
    label: '模型',
    description: '填入各提供方的 API 密钥即可使用其模型。',
    icon: BotIcon,
  },

  { id: 'permissions', label: '权限管理', description: '查看和撤销授权', icon: ShieldCheckIcon },
  { id: 'skills', label: 'Skills', description: '查看可用的本地 Skills', icon: SparklesIcon },
  { id: 'memory', label: 'Memory', description: '查看和删除长期记忆', icon: BrainIcon },
  {
    id: 'knowledge',
    label: 'Knowledge',
    description: '导入文档和代码，管理知识索引与来源',
    icon: BookOpenIcon,
  },
  { id: 'mcp', label: 'MCP Servers', description: '配置和连接 MCP 工具', icon: ServerIcon },
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
          ) : tab === 'skills' ? (
            <SkillSettings />
          ) : tab === 'memory' ? (
            <MemorySettings />
          ) : tab === 'knowledge' ? (
            <KnowledgeSettings settings={settings} onChanged={onChanged} />
          ) : tab === 'mcp' ? (
            <McpSettings settings={settings} onChanged={onChanged} />
          ) : (
            <PermissionSettings
              settings={settings}
              permissionGrants={permissionGrants}
              revoking={revoking}
              revokeError={revokeError}
              onRevoke={revoke}
              onChanged={onChanged}
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


type EditorMode = 'builtin' | 'custom'
type SavedProvider = NonNullable<AgentSettingsSnapshot['providers']>[number]

function getProviderEntries(settings: AgentSettingsSnapshot): SavedProvider[] {
  if (settings.providers) return settings.providers

  const providers = new Map<string, SavedProvider>()
  for (const model of settings.models ?? []) {
    const catalogProvider = settings.catalog?.find((item) => item.id === model.provider)
    const entry = providers.get(model.provider) ?? {
      id: model.provider,
      name: model.providerName ?? catalogProvider?.name ?? model.provider,
      builtin: catalogProvider?.builtin !== false,
      hasApiKey: model.hasApiKey,
      models: [],
    }
    if (!entry.models.some((item) => item.id === model.modelID)) {
      entry.models.push({
        id: model.modelID,
        ...(model.modelName ? { name: model.modelName } : {}),
        ...(model.api ? { api: model.api } : {}),
        ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
        ...(model.input ? { input: [...model.input] } : {}),
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
      })
    }
    providers.set(model.provider, entry)
  }

  if (!providers.size && settings.provider) {
    const catalogProvider = settings.catalog?.find((item) => item.id === settings.provider)
    providers.set(settings.provider, {
      id: settings.provider,
      name: catalogProvider?.name ?? settings.provider,
      builtin: catalogProvider?.builtin !== false,
      hasApiKey: settings.hasApiKey,
      models: [],
    })
  }

  return [...providers.values()]
}

function toProviderConfig(provider: SavedProvider): ProviderConfig {
  return {
    id: provider.id,
    ...(provider.name ? { name: provider.name } : {}),
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...(provider.api ? { api: provider.api } : {}),
    ...(provider.models?.length
      ? {
          models: provider.models.map((model) => ({
            id: model.id,
            ...(model.name ? { name: model.name } : {}),
            ...(model.api ? { api: model.api } : {}),
            ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
            ...(model.input ? { input: [...model.input] } : {}),
            ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
            ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
          })),
        }
      : {}),
  }
}

function findAvailableBuiltinProvider(
  catalog: AgentSettingsSnapshot['catalog'],
  providers: readonly SavedProvider[],
) {
  return catalog.find(
    (item) => item.builtin !== false && !providers.some((entry) => entry.id === item.id),
  )
}

function ModelSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  const initialProviders = getProviderEntries(settings)
  const initialBuiltinProvider = findAvailableBuiltinProvider(settings.catalog, initialProviders)

  const [providerEntries, setProviderEntries] = useState<SavedProvider[]>(initialProviders)
  const [compaction, setCompaction] = useState<AgentCompactionSettings>(
    settings.compaction ?? DEFAULT_AGENT_COMPACTION_SETTINGS,
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editorMode, setEditorMode] = useState<EditorMode>('builtin')
  const [provider, setProvider] = useState(initialBuiltinProvider?.id ?? '')
  const [providerName, setProviderName] = useState('')
  const [api, setApi] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [customModels, setCustomModels] = useState<ProviderModelConfig[]>([])
  const [modelID, setModelID] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [deleteApiKey, setDeleteApiKey] = useState(false)
  const [discoveredModels, setDiscoveredModels] = useState<ModelCatalogModel[]>([])
  const [discoveredProvider, setDiscoveredProvider] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [showCustomSettings, setShowCustomSettings] = useState(false)
  const [showModelDraft, setShowModelDraft] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const nextProviderEntries = getProviderEntries(settings)
    setProviderEntries(nextProviderEntries)
    setCompaction(settings.compaction ?? DEFAULT_AGENT_COMPACTION_SETTINGS)
    setEditingId(null)
    setEditorMode('builtin')
    setProvider(findAvailableBuiltinProvider(settings.catalog, nextProviderEntries)?.id ?? '')
    setProviderName('')
    setApi('')
    setBaseUrl('')
    setCustomModels([])
    setModelID('')
    setApiKey('')
    setDeleteApiKey(false)
    setDiscoveredModels([])
    setDiscoveredProvider(null)
    setShowCustomSettings(false)
    setShowModelDraft(false)
  }, [settings])

  const selectedProvider = providerEntries.find((item) => item.id === provider)
  const selectedProviderHasKey =
    selectedProvider?.hasApiKey ?? (settings.provider === provider && settings.hasApiKey)
  const builtinProviders = settings.catalog?.filter((item) => item.builtin !== false) ?? []
  const customProviders = providerEntries.filter((entry) => !entry.builtin)
  const selectableBuiltinProviders = builtinProviders.filter(
    (item) => !providerEntries.some((entry) => entry.id === item.id) || item.id === editingId,
  )
  const selectableCustomProviders = customProviders.filter((entry) => entry.id === editingId)

  const clearModelDraft = () => {
    setModelID('')
    setShowModelDraft(false)
  }

  const loadProvider = (entry: SavedProvider | undefined, providerID: string, mode: EditorMode) => {
    setEditingId(entry?.id ?? null)
    setEditorMode(mode)
    setProvider(providerID)
    setProviderName(mode === 'custom' ? (entry?.name ?? '') : '')
    setApi(entry?.api ?? (mode === 'custom' ? 'openai-completions' : ''))
    setBaseUrl(entry?.baseUrl ?? '')
    const nextModels =
      entry?.models?.map((model) => ({ ...model, input: model.input?.slice() })) ?? []
    setCustomModels(nextModels)
    clearModelDraft()
    setApiKey('')
    setDeleteApiKey(false)
    setDiscoveredModels([])
    setDiscoveredProvider(null)
    setShowCustomSettings(mode === 'custom')
    setSaveError(null)
    setSaved(false)
  }

  const resetEditor = () => {
    const nextProvider = findAvailableBuiltinProvider(settings.catalog, providerEntries)
    loadProvider(undefined, nextProvider?.id ?? '', 'builtin')
  }

  const edit = (entry: SavedProvider) => {
    loadProvider(entry, entry.id, entry.builtin ? 'builtin' : 'custom')
  }

  const persistProviders = async (
    nextProviders: ProviderConfig[],
    credential?: UpdateAgentSettingsRequest['credential'],
    nextCompaction: AgentCompactionSettings = compaction,
  ) => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      await window.api.updateAgentSettings({
        providers: nextProviders,
        credential,
        compaction: nextCompaction,
      })
      await onChanged()
      setSaved(true)
      setEditingId(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '设置保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  const selectBuiltinProvider = (providerID: string) => {
    const existing = providerEntries.find((entry) => entry.id === providerID)
    loadProvider(existing, providerID, 'builtin')
  }

  const chooseProvider = (providerID: string) => {
    const entry = providerEntries.find((item) => item.id === providerID)
    if (entry?.builtin === false) edit(entry)
    else selectBuiltinProvider(providerID)
  }

  const discoverModels = async () => {
    setDiscovering(true)
    setSaveError(null)
    try {
      const result = await window.api.discoverModels({
        provider,
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(api.trim() ? { api: api.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setDiscoveredModels(result)
      setDiscoveredProvider(provider)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '获取模型目录失败，请重试。')
    } finally {
      setDiscovering(false)
    }
  }

  const addDiscoveredModel = (model: ModelCatalogModel) => {
    if (model.builtin) return
    if (customModels.some((item) => item.id === model.id)) return
    setCustomModels((current) => [
      ...current,
      {
        id: model.id,
        name: model.name,
        ...(editorMode === 'custom' && model.api ? { api: model.api } : {}),
        reasoning: model.reasoning,
        input: [...model.input],
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      },
    ])
    setSaved(false)
  }

  const addManualModel = () => {
    const normalizedID = modelID.trim()
    if (!normalizedID) {
      setSaveError('请填写模型 ID。')
      return
    }
    if (customModels.some((model) => model.id === normalizedID)) {
      setSaveError('这个模型已经添加过了。')
      return
    }

    setCustomModels((current) => [...current, { id: normalizedID }])
    clearModelDraft()
    setSaveError(null)
    setSaved(false)
  }

  const saveProvider = async () => {
    const normalizedProvider = provider.trim()
    const normalizedBaseUrl = baseUrl.trim()
    if (!normalizedProvider) {
      setSaveError('请填写提供商 ID。')
      return
    }
    if (editorMode === 'custom' && !normalizedBaseUrl) {
      setSaveError('自定义提供商必须填写 API 地址。')
      return
    }
    if (
      providerEntries.some((entry) => entry.id === normalizedProvider && entry.id !== editingId)
    ) {
      setSaveError('这个提供商已经添加过了。')
      return
    }

    const nextProvider: ProviderConfig = {
      id: normalizedProvider,
      ...(editorMode === 'custom' && providerName.trim() ? { name: providerName.trim() } : {}),
      ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
      ...(api.trim() ? { api: api.trim() } : {}),
      ...(customModels.length
        ? { models: customModels.map((model) => ({ ...model, input: model.input?.slice() })) }
        : {}),
    }
    const nextProviders = editingId
      ? providerEntries.map((entry) =>
          entry.id === editingId ? nextProvider : toProviderConfig(entry),
        )
      : [...providerEntries.map(toProviderConfig), nextProvider]
    await persistProviders(nextProviders, {
      provider: normalizedProvider,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(deleteApiKey ? { deleteApiKey: true } : {}),
    })
  }

  const deleteProvider = async (entry: SavedProvider) => {
    if (providerEntries.length <= 1) return
    const nextProviders = providerEntries
      .filter((item) => item.id !== entry.id)
      .map(toProviderConfig)
    await persistProviders(nextProviders, { provider: entry.id, deleteApiKey: true })
  }


  return (
    <section aria-labelledby="model-section-title">
      <h2 id="model-section-title" className="mb-3 text-xs font-medium">
        已保存的模型提供商
      </h2>
      <SettingsCard>
        {providerEntries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-3 px-4 py-3.5">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              aria-label={`${entry.name}${entry.models.length ? `，可用模型 ${entry.models.map((model) => model.name ?? model.id).join('、')}` : ''}`}
              onClick={() => edit(entry)}
            >
              <p className="flex items-center gap-2 truncate text-sm font-medium">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    entry.hasApiKey ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                  )}
                  aria-hidden="true"
                />
                {entry.name}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {entry.id} · {entry.hasApiKey ? 'API Key 已配置' : '需要 API Key'}
              </p>
            </button>
            <Button type="button" variant="outline" size="sm" onClick={() => edit(entry)}>
              编辑
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`删除提供商 ${entry.name}`}
              disabled={providerEntries.length <= 1 || saving}
              onClick={() => void deleteProvider(entry)}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        {providerEntries.length === 0 && (
          <p className="text-muted-foreground px-4 py-4 text-sm">尚未配置模型提供商。</p>
        )}
      </SettingsCard>

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium">{editingId ? '编辑提供商' : '添加模型提供商'}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={resetEditor}>
          <PlusIcon className="size-3.5" /> 添加提供商
        </Button>
      </div>
      <SettingsCard>
        <SettingsField label="提供方" description="模型服务商来自 pi-ai 的内置目录">
          <select
            aria-label="模型服务商"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={provider}
            onChange={(event) => chooseProvider(event.target.value)}
          >
            {selectableBuiltinProviders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            {selectableCustomProviders.length > 0 && (
              <optgroup label="自定义提供商">
                {selectableCustomProviders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            )}
            {selectableBuiltinProviders.length === 0 && selectableCustomProviders.length === 0 && (
              <option value="" disabled>
                没有可添加的提供方
              </option>
            )}
          </select>
        </SettingsField>

        <SettingsField label="API 密钥" description="密钥不会返回到渲染进程">
          <div className="flex gap-2">
            <Input
              aria-label="API 密钥"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                setDeleteApiKey(false)
              }}
              placeholder="输入 API 密钥"
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

        <div className="border-border/70 border-t px-4">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 py-3 text-left text-sm"
            aria-expanded={showCustomSettings}
            onClick={() => setShowCustomSettings((current) => !current)}
          >
            <span className={cn('transition-transform', showCustomSettings && 'rotate-90')}>›</span>
            自定义设置
          </button>
        </div>
        {showCustomSettings && (
          <>
            <SettingsField label="API 地址" description="内置提供商留空时使用提供方默认地址">
              <Input
                aria-label="API 地址"
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value)
                  setSaved(false)
                }}
                placeholder={editorMode === 'builtin' ? '提供方默认' : 'https://api.example.com/v1'}
              />
            </SettingsField>
            <SettingsField
              label="模型目录"
              description="pi-ai 模型会自动进入聊天页；这里只添加目录外模型"
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={discovering || !provider.trim()}
                    onClick={() => void discoverModels()}
                  >
                    {discovering ? '获取中…' : '获取可用模型'}
                  </Button>
                  {editorMode === 'builtin' && !baseUrl.trim() && (
                    <span className="text-muted-foreground text-xs">使用 pi-ai 内置目录</span>
                  )}
                </div>
                {customModels.length > 0 ? (
                  <div className="border-border/70 grid gap-1 rounded-md border p-2">
                    {customModels.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {model.name ?? model.id}
                          {model.name && (
                            <span className="text-muted-foreground ml-2">{model.id}</span>
                          )}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCustomModels((current) =>
                              current.filter((item) => item.id !== model.id),
                            )
                            setSaved(false)
                          }}
                        >
                          移除
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <p className="text-muted-foreground text-xs">
                      {editorMode === 'builtin'
                        ? 'pi-ai 内置模型会自动显示在聊天页'
                        : '正在使用适配器默认模型'}
                    </p>
                    {editorMode === 'custom' && (
                      <div className="border-border/70 text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs">
                        模型选择器中将不显示任何模型；目录外 ID 仍可直接发送。
                      </div>
                    )}
                  </>
                )}
                {showModelDraft ? (
                  <div className="flex gap-2">
                    <Input
                      aria-label="模型 ID"
                      value={modelID}
                      onChange={(event) => setModelID(event.target.value)}
                      placeholder="例如 deepseek-v4.1-flash"
                    />
                    <Button type="button" variant="outline" onClick={addManualModel}>
                      添加模型
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      clearModelDraft()
                      setShowModelDraft(true)
                    }}
                  >
                    添加模型
                  </Button>
                )}
                {discoveredProvider === provider && discoveredModels.length > 0 && (
                  <div className="border-border/70 grid gap-1 rounded-md border p-2">
                    {discoveredModels.map((model) => {
                      const added = customModels.some((item) => item.id === model.id)
                      const builtin = model.builtin === true
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className="hover:bg-muted flex items-center justify-between rounded px-2 py-1.5 text-left text-xs disabled:cursor-default disabled:opacity-60"
                          disabled={added || builtin}
                          onClick={() => addDiscoveredModel(model)}
                        >
                          <span className="truncate">{model.name}</span>
                          <span className="text-muted-foreground ml-3 shrink-0">
                            {builtin ? '内置' : added ? '已添加' : '添加'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </SettingsField>
          </>
        )}
        <div className="flex justify-end px-4 py-3.5">
          <Button
            type="button"
            disabled={saving || !provider.trim() || (editorMode === 'custom' && !baseUrl.trim())}
            onClick={() => void saveProvider()}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </SettingsCard>



      <h2 className="mt-8 mb-3 text-xs font-medium">上下文</h2>
      <SettingsCard>
        <div className="flex items-start justify-between gap-4 px-4 py-3.5">
          <div>
            <p className="text-sm font-medium">Automatic context compaction</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              使用 Pi 的自动压缩，在新建 Session 时应用。
            </p>
          </div>
          <input
            type="checkbox"
            aria-label="Automatic context compaction"
            className="accent-foreground mt-0.5 size-4"
            checked={compaction.enabled}
            onChange={(event) => {
              setCompaction((current) => ({ ...current, enabled: event.target.checked }))
              setSaved(false)
            }}
          />
        </div>
        <details className="border-border/70 border-t px-4 py-3.5">
          <summary className="cursor-pointer text-sm font-medium">高级参数</summary>
          <div className="mt-3 grid gap-3">
            <SettingsField label="Reserve tokens" description="为压缩后的继续执行保留的 token 数量">
              <Input
                type="number"
                min={0}
                step={1}
                value={compaction.reserveTokens}
                onChange={(event) => {
                  setCompaction((current) => ({
                    ...current,
                    reserveTokens: Number(event.target.value),
                  }))
                  setSaved(false)
                }}
              />
            </SettingsField>
            <SettingsField label="Keep recent tokens" description="压缩时保留最近消息的 token 数量">
              <Input
                type="number"
                min={0}
                step={1}
                value={compaction.keepRecentTokens}
                onChange={(event) => {
                  setCompaction((current) => ({
                    ...current,
                    keepRecentTokens: Number(event.target.value),
                  }))
                  setSaved(false)
                }}
              />
            </SettingsField>
          </div>
        </details>
        <div className="flex justify-end px-4 py-3.5">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() =>
              void persistProviders(providerEntries.map(toProviderConfig), undefined, compaction)
            }
          >
            保存上下文设置
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
          设置已保存并生效，聊天页会自动加载可用模型。
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


function SkillSettings() {
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  const loadSkills = async (reload: boolean) => {
    if (reload) setReloading(true)
    else setLoading(true)
    setError(null)
    try {
      const nextSkills = reload
        ? await window.api.reloadAgentSkills()
        : await window.api.listAgentSkills()
      setSkills(nextSkills)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Skills 读取失败，请重试。')
    } finally {
      if (reload) setReloading(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    void loadSkills(false)
  }, [])

  return (
    <section aria-labelledby="skills-section-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="skills-section-title" className="text-xs font-medium">
            可用 Skills
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            在对话中输入 /skill-name 调用，也可以使用 Pi 原生的 /skill:skill-name。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={reloading}
          onClick={() => void loadSkills(true)}
        >
          <RefreshCwIcon className={reloading ? 'animate-spin' : undefined} />
          刷新
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          正在读取 Skills…
        </p>
      ) : skills.length === 0 ? (
        <div className="rounded-xl border border-dashed px-5 py-9 text-center">
          <SparklesIcon className="text-muted-foreground/60 mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">暂无可用 Skills</p>
          <p className="text-muted-foreground mt-1 text-xs">
            将 Skill 放入 ~/.agents/skills 后点击刷新。
          </p>
        </div>
      ) : (
        <SettingsCard>
          {skills.map((skill) => (
            <div key={skill.id} className="px-4 py-3.5">
              <p className="text-sm font-medium">{skill.name}</p>
              <p className="text-muted-foreground mt-1 break-all font-mono text-xs">/{skill.id}</p>
              {skill.description && (
                <p className="text-muted-foreground mt-1 text-xs">{skill.description}</p>
              )}
            </div>
          ))}
        </SettingsCard>
      )}
    </section>
  )
}

function MemorySettings() {
  const { workspaces } = useWorkspaces()
  const [workspaceId, setWorkspaceId] = useState<string>('global')
  const [memories, setMemories] = useState<AgentMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadMemories = async () => {
    setLoading(true)
    setError(null)
    try {
      setMemories(await window.api.listMemories(workspaceId === 'global' ? undefined : workspaceId))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Memory 读取失败，请重试。')
    } finally {
      setLoading(false)
    }
  }

  const removeMemory = async (id: string) => {
    setDeleting(id)
    setError(null)
    try {
      await window.api.deleteMemory({ id })
      setMemories((current) => current.filter((memory) => memory.id !== id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Memory 删除失败，请重试。')
    } finally {
      setDeleting(null)
    }
  }

  useEffect(() => {
    void loadMemories()
  }, [workspaceId])

  return (
    <section aria-labelledby="memory-section-title">
      <Select value={workspaceId} onValueChange={value => { if (value) setWorkspaceId(value) }}>
        <SelectTrigger className="mb-4">{workspaceId === 'global' ? '全局 Memory' : workspaces.find(item => item.id === workspaceId)?.displayName}</SelectTrigger>
        <SelectContent><SelectItem value="global">全局 Memory</SelectItem>{workspaces.map(item => <SelectItem key={item.id} value={item.id}>{item.displayName}</SelectItem>)}</SelectContent>
      </Select>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="memory-section-title" className="text-xs font-medium">
            已保存的 Memory
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Agent 只会在明确调用 save_memory 时保存长期信息。
          </p>
        </div>
        <span className="text-muted-foreground text-xs">{memories.length} 条</span>
      </div>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          正在读取 Memory…
        </p>
      ) : memories.length === 0 ? (
        <div className="rounded-xl border border-dashed px-5 py-9 text-center">
          <BrainIcon className="text-muted-foreground/60 mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">暂无已保存的 Memory</p>
          <p className="text-muted-foreground mt-1 text-xs">Agent 保存长期信息后，会在这里显示。</p>
        </div>
      ) : (
        <SettingsCard>
          {memories.map((memory) => (
            <div key={memory.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-[10px]">
                    {memory.scope === 'global' ? '全局' : '当前 Workspace'}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    更新于 {formatMemoryTime(memory.updatedAt)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{memory.content}</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="删除 Memory"
                title="删除 Memory"
                disabled={deleting === memory.id}
                onClick={() => void removeMemory(memory.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </SettingsCard>
      )}
    </section>
  )
}

function formatMemoryTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    timestamp,
  )
}

function PermissionSettings({
  settings,
  permissionGrants,
  revoking,
  revokeError,
  onRevoke,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  permissionGrants: AgentSettingsSnapshot['permissionGrants']
  revoking: string | null
  revokeError: string | null
  onRevoke: (id: string) => Promise<void>
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const change = async (mode: PermissionMode | null) => {
    if (!mode) return
    try { await window.api.updateAgentSettings({ defaultPermissionMode: mode }); await onChanged(); notifyWorkspaceChanged() }
    catch (error) { setError(error instanceof Error ? error.message : '保存失败') }
  }
  return (
    <>
      <section aria-labelledby="default-permission-policy">
        <h2 id="default-permission-policy" className="mb-3 text-xs font-medium">默认权限</h2>
        <Select value={settings.defaultPermissionMode ?? 'workspace-write'} onValueChange={value => void change(value)}>
          <SelectTrigger>{PERMISSION_LABELS[settings.defaultPermissionMode ?? 'workspace-write']}</SelectTrigger>
          <SelectContent>{PERMISSION_MODES.map(mode => <SelectItem key={mode} value={mode}>{PERMISSION_LABELS[mode]}</SelectItem>)}</SelectContent>
        </Select>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <p className="mt-3 text-xs text-text-muted">默认权限适用于新会话。未分组会话无法使用工作区内修改；工作区外操作和受限模式下的命令需单次审批。</p>
      </section>

      <div className="mt-8 mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xs font-medium">高级 · 历史授权</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            旧版工具授权仅保留供查看和撤销，不参与当前权限判断。
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
            新的审批仅对当前调用生效。
          </p>
        </div>
      ) : (
        <SettingsCard>
          {permissionGrants.map((grant) => (
            <div key={grant.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>
                    {toolDescriptions[grant.permission.toolName] ?? grant.permission.toolName}
                  </span>
                  <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-[10px] uppercase">
                    {grant.duration}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 break-all font-mono text-xs">
                  内置工具 · {grant.permission.toolName}
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
