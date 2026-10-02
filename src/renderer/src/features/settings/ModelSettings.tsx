import { useEffect, useState } from 'react'
import { ChevronRightIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import type {
  AgentSettingsSnapshot,
  ModelCatalogModel,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import type { ProviderConfig, ProviderModelConfig } from '@/shared/agent/agentConfig'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { SettingsCard, SettingsField } from './SettingsComponents'
import { cn } from '../../lib/utils'

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

export function ModelSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  const initialProviders = getProviderEntries(settings)
  const initialBuiltinProvider = findAvailableBuiltinProvider(settings.catalog, initialProviders)

  const [providerEntries, setProviderEntries] = useState<SavedProvider[]>(initialProviders)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
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
    setEditingId(null)
    setProviderDialogOpen(false)
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

  const addProvider = () => {
    const nextProvider = findAvailableBuiltinProvider(settings.catalog, providerEntries)
    loadProvider(undefined, nextProvider?.id ?? '', 'builtin')
    setProviderDialogOpen(true)
  }

  const edit = (entry: SavedProvider) => {
    loadProvider(entry, entry.id, entry.builtin ? 'builtin' : 'custom')
    setProviderDialogOpen(true)
  }

  const persistProviders = async (
    nextProviders: ProviderConfig[],
    credential?: UpdateAgentSettingsRequest['credential'],
  ) => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      await window.api.updateAgentSettings({ providers: nextProviders, credential })
      await onChanged()
      setSaved(true)
      setEditingId(null)
      setProviderDialogOpen(false)
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
      setSaveError(error instanceof Error ? error.message : '获取模型列表失败，请重试。')
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
      setSaveError('请填写服务商标识。')
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
    <section className="space-y-8">
      <section aria-labelledby="model-providers-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="model-providers-title" className="text-sm font-medium">
            模型提供商
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={addProvider}>
            <PlusIcon className="size-3.5" /> 添加
          </Button>
        </div>
        <SettingsCard>
          {providerEntries.map((entry) => {
            const modelCount = settings.models.filter((model) => model.provider === entry.id).length
            return (
              <div key={entry.id} className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left hover:bg-interactive-hover"
                  aria-label={`编辑 ${entry.name}`}
                  onClick={() => edit(entry)}
                >
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      entry.hasApiKey ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{entry.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {entry.hasApiKey ? '密钥已配置' : '需要 API 密钥'} · {modelCount} 个模型
                    </span>
                  </span>
                  <ChevronRightIcon className="text-text-faint size-4 shrink-0" />
                </button>
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
            )
          })}
          {providerEntries.length === 0 && (
            <p className="text-muted-foreground px-4 py-4 text-sm">尚未配置模型提供商。</p>
          )}
        </SettingsCard>
      </section>

      <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? `编辑 ${selectedProvider?.name ?? '提供商'}` : '添加模型提供商'}
            </DialogTitle>
          </DialogHeader>
          {!editingId && (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={editorMode === 'builtin' ? 'default' : 'outline'}
                onClick={() => {
                  const nextProvider = findAvailableBuiltinProvider(
                    settings.catalog,
                    providerEntries,
                  )
                  loadProvider(undefined, nextProvider?.id ?? '', 'builtin')
                }}
              >
                内置提供商
              </Button>
              <Button
                type="button"
                size="sm"
                variant={editorMode === 'custom' ? 'default' : 'outline'}
                onClick={() => loadProvider(undefined, '', 'custom')}
              >
                自定义提供商
              </Button>
            </div>
          )}
          <SettingsCard>
            {editorMode === 'builtin' ? (
              <SettingsField label="模型服务商" description="选择要使用的服务商。">
                <Select
                  value={provider}
                  onValueChange={(value) => value !== null && chooseProvider(value)}
                >
                  <SelectTrigger aria-label="模型服务商" className="h-9">
                    {[...selectableBuiltinProviders, ...selectableCustomProviders].find(
                      (item) => item.id === provider,
                    )?.name ?? '没有可添加的提供方'}
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {selectableBuiltinProviders.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                    {selectableCustomProviders.length > 0 && (
                      <div role="group" aria-label="自定义提供商">
                        <p className="px-2 py-1.5 text-xs text-text-muted">自定义提供商</p>
                        {selectableCustomProviders.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </div>
                    )}
                    {selectableBuiltinProviders.length === 0 &&
                      selectableCustomProviders.length === 0 && (
                        <SelectItem value="" disabled>
                          没有可添加的提供方
                        </SelectItem>
                      )}
                  </SelectContent>
                </Select>
              </SettingsField>
            ) : (
              <>
                <SettingsField label="服务商标识" description="用于区分不同的服务商。">
                  <Input
                    aria-label="服务商标识"
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                    placeholder="例如：公司模型"
                  />
                </SettingsField>
                <SettingsField label="显示名称" description="显示在服务商列表中。">
                  <Input
                    aria-label="显示名称"
                    value={providerName}
                    onChange={(event) => setProviderName(event.target.value)}
                    placeholder="自定义提供商"
                  />
                </SettingsField>
              </>
            )}

            <SettingsField label="API 密钥" description="留空则保留当前密钥。">
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
                <span className={cn('transition-transform', showCustomSettings && 'rotate-90')}>
                  ›
                </span>
                自定义设置
              </button>
            </div>
            {showCustomSettings && (
              <>
                <SettingsField label="API 地址" description="填写服务商提供的 API 地址。">
                  <Input
                    aria-label="API 地址"
                    value={baseUrl}
                    onChange={(event) => {
                      setBaseUrl(event.target.value)
                      setSaved(false)
                    }}
                    placeholder={
                      editorMode === 'builtin' ? '默认 API 地址' : 'https://api.example.com/v1'
                    }
                  />
                </SettingsField>
                <SettingsField label="模型列表" description="添加要在对话中使用的模型。">
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
                        <span className="text-muted-foreground text-xs">服务商模型</span>
                      )}
                    </div>
                    {customModels.length > 0 ? (
                      <div className="glass-surface grid gap-1 rounded-md p-2">
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
                            ? '服务商提供的可用模型会显示在这里。'
                            : '请添加要使用的模型。'}
                        </p>
                        {editorMode === 'custom' && (
                          <div className="border-border/70 text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs">
                            添加模型后，即可在对话中使用。
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
                      <div className="glass-surface grid gap-1 rounded-md p-2">
                        {discoveredModels.map((model) => {
                          const added = customModels.some((item) => item.id === model.id)
                          const builtin = model.builtin === true
                          return (
                            <button
                              key={model.id}
                              type="button"
                              className="hover:bg-interactive-hover active:bg-interactive-pressed focus-visible:ring-1 focus-visible:ring-brand-border outline-none transition-colors flex items-center justify-between rounded px-2 py-1.5 text-left text-xs disabled:cursor-default disabled:opacity-60"
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
                disabled={
                  saving || !provider.trim() || (editorMode === 'custom' && !baseUrl.trim())
                }
                onClick={() => void saveProvider()}
              >
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </SettingsCard>
          {deleteApiKey && <p className="text-amber-600 text-xs">保存后将删除已保存的密钥。</p>}
          {saveError && (
            <p className="text-destructive text-sm" role="alert">
              {saveError}
            </p>
          )}
        </DialogContent>
      </Dialog>
      {!settings.credentialPersistenceAvailable && (
        <p className="text-amber-600 mt-3 text-xs" role="status">
          关闭应用后，需要重新填写 API 密钥。
        </p>
      )}
      {saveError && !providerDialogOpen && (
        <p className="text-destructive mt-3 text-sm" role="alert">
          {saveError}
        </p>
      )}
      {saved && (
        <p className="text-emerald-600 mt-3 text-sm" role="status">
          模型服务商已保存。
        </p>
      )}
    </section>
  )
}
