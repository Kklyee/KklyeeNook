import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type {
  AgentSettingsSnapshot,
  DiscoverModelsRequest,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { ApprovalPolicy } from '../approval/approvalPolicy'
import type { CredentialStore } from './credentialStore'
import type { DeletePermissionGrantRequest } from '@/shared/approval/approvalTypes'
import type {
  AgentConfig,
  ProviderConfig,
  ProviderModelConfig,
  SavedModelConfig,
} from '@/shared/agent/agentConfig'
import type { AgentConfigStore } from './agentConfigStore'
import {
  getActiveModel,
  getConfiguredProviders,
  getSavedModels,
  modelConfigId,
} from '@/shared/agent/agentConfig'
import {
  getConfiguredModelConfigs,
  getModelCatalog,
  hasBuiltinModel,
  hasBuiltinProvider,
  mergeConfiguredProvidersIntoCatalog,
  mergeSavedModelsIntoCatalog,
} from './modelCatalog'
import { discoverRemoteModels } from './modelDiscovery'

export interface AgentSettingsChangeHooks {
  prepare(): void | Promise<void>
  commit(): void | Promise<void>
  cancel(): void | Promise<void>
}

export function registerSettingsIpc(
  window: BrowserWindow,
  configStore: AgentConfigStore,
  credentials: CredentialStore,
  policy: ApprovalPolicy,
  settingsChange: AgentSettingsChangeHooks,
) {
  const assertTrustedSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('不允许读取配置')
    }
  }

  const snapshot = async (): Promise<AgentSettingsSnapshot> => {
    const config = configStore.get()
    if (!config.cwd) throw new Error('Agent workspace is not configured')
    const configuredProviders = getConfiguredProviders(config)
    const catalog = mergeConfiguredProvidersIntoCatalog(getModelCatalog(), configuredProviders)
    const expandedModels = getConfiguredModelConfigs(configuredProviders, catalog)
    const savedModels = expandedModels.length ? expandedModels : getSavedModels(config)
    const activeModel =
      savedModels.find((model) => model.id === config.activeModelId) ??
      savedModels.find(
        (model) =>
          model.provider === config.model.provider && model.modelID === config.model.modelID,
      ) ??
      getActiveModel({ ...config, models: savedModels })
    const providerNames = new Map(catalog.map((provider) => [provider.id, provider.name]))
    const modelNames = new Map(
      catalog.flatMap((provider) =>
        provider.models.map((model) => [`${provider.id}:${model.id}`, model.name] as const),
      ),
    )
    return {
      provider: activeModel.provider,
      modelID: activeModel.modelID,
      baseUrl: activeModel.baseUrl,
      providerName: providerNames.get(activeModel.provider),
      contextWindow: activeModel.contextWindow,
      maxTokens: activeModel.maxTokens,
      thinkingLevel: activeModel.thinkingLevel ?? 'medium',
      cwd: config.cwd,
      hasApiKey: credentials.hasApiKey(activeModel.provider),
      activeModelId: activeModel.id,
      models: savedModels.map((model) => ({
        ...model,
        providerName: providerNames.get(model.provider) ?? model.providerName ?? model.provider,
        modelName:
          modelNames.get(`${model.provider}:${model.modelID}`) ?? model.modelName ?? model.modelID,
        hasApiKey: credentials.hasApiKey(model.provider),
      })),
      providers: configuredProviders.map((provider) => ({
        ...provider,
        name: provider.name ?? catalog.find((item) => item.id === provider.id)?.name ?? provider.id,
        models: (provider.models ?? []).map((model) => ({ ...model })),
        builtin: hasBuiltinProvider(provider.id),
        hasApiKey: credentials.hasApiKey(provider.id),
      })),
      catalog,
      credentialPersistenceAvailable: credentials.isPersistenceAvailable(),
      tools: config.tools.enabled.map((name) => ({
        name,
        requiresApproval: policy.protects(name),
      })),
      permissionGrants: await policy.listGrants(),
    }
  }

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (event): Promise<AgentSettingsSnapshot> => {
    assertTrustedSender(event)
    return snapshot()
  })
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_UPDATE,
    async (event, request: UpdateAgentSettingsRequest): Promise<AgentSettingsSnapshot> => {
      assertTrustedSender(event)
      if (
        !request ||
        (!Array.isArray(request.providers) && !Array.isArray(request.models)) ||
        typeof request.cwd !== 'string'
      ) {
        throw new Error('Agent 设置格式无效')
      }
      const current = configStore.get()
      const cwd = resolve(request.cwd.trim())
      if (!request.cwd.trim() || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
        throw new Error('Workspace 必须是一个存在的目录')
      }
      const providerUpdate = Array.isArray(request.providers)
      const providers = providerUpdate
        ? (request.providers as ProviderConfig[]).map(validateProvider)
        : getConfiguredProviders(current)
      if (providerUpdate && providers.length === 0) {
        throw new Error('至少需要配置一个模型提供商')
      }
      if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
        throw new Error('不能重复添加同一个提供商')
      }

      let models: ReturnType<typeof validateModel>[]
      let activeModel: ReturnType<typeof validateModel> | undefined
      if (providerUpdate) {
        const catalog = mergeConfiguredProvidersIntoCatalog(getModelCatalog(), providers)
        const expanded = getConfiguredModelConfigs(providers, catalog)
        models = (expanded.length ? expanded : getSavedModels(current)).map(validateModel)
        const requestedActiveModelId = request.activeModelId ?? current.activeModelId
        activeModel =
          models.find((model) => model.id === requestedActiveModelId) ??
          models.find(
            (model) =>
              model.provider === current.model.provider && model.modelID === current.model.modelID,
          ) ??
          models[0]
      } else {
        if (!request.models?.length) throw new Error('至少需要配置一个模型')
        models = request.models.map(validateModel)
        activeModel = models.find((model) => model.id === request.activeModelId)
      }
      if (new Set(models.map((model) => model.id)).size !== models.length) {
        throw new Error('不能重复添加同一个模型')
      }
      if (!activeModel) throw new Error('没有可用的活动模型')

      const nextConfig: AgentConfig = {
        ...current,
        cwd,
        models,
        activeModelId: activeModel.id,
        model: activeModel,
        ...(providerUpdate ? { providers } : {}),
      }
      const credentialProvider = request.credential?.provider
      const previousApiKey = credentialProvider
        ? credentials.getApiKey(credentialProvider)
        : undefined

      await settingsChange.prepare()
      try {
        configStore.set(nextConfig)
        if (request.credential?.deleteApiKey) {
          credentials.deleteApiKey(request.credential.provider)
        } else if (request.credential?.apiKey?.trim()) {
          credentials.setApiKey(request.credential.provider, request.credential.apiKey.trim())
        }
        await settingsChange.commit()
      } catch (error) {
        configStore.set(current)
        if (credentialProvider) {
          if (previousApiKey) credentials.setApiKey(credentialProvider, previousApiKey)
          else credentials.deleteApiKey(credentialProvider)
        }
        await Promise.resolve(settingsChange.cancel()).catch(() => undefined)
        throw error
      }
      return snapshot()
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_DISCOVER_MODELS,
    async (event, request: DiscoverModelsRequest) => {
      assertTrustedSender(event)
      if (!request || typeof request.provider !== 'string' || !request.provider.trim()) {
        throw new Error('提供商配置无效')
      }

      const provider = request.provider.trim()
      const baseUrl = request.baseUrl?.trim()
      if (!baseUrl && hasBuiltinProvider(provider)) {
        return (
          mergeSavedModelsIntoCatalog(getModelCatalog(), []).find((item) => item.id === provider)
            ?.models ?? []
        )
      }

      return discoverRemoteModels({
        baseUrl: baseUrl ?? '',
        api: request.api?.trim() || undefined,
        apiKey: request.apiKey?.trim() || credentials.getApiKey(provider),
      })
    },
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SELECT_WORKSPACE, async (event): Promise<string | null> => {
    assertTrustedSender(event)
    const result = await dialog.showOpenDialog(window, {
      title: '选择 Agent 工作目录',
      defaultPath: configStore.get().cwd,
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(
    IPC_CHANNELS.PERMISSION_GRANT_DELETE,
    async (event, request: DeletePermissionGrantRequest): Promise<void> => {
      assertTrustedSender(event)
      await policy.revoke(request.id)
    },
  )
  window.once('closed', () => {
    ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_GET)
    ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_UPDATE)
    ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_DISCOVER_MODELS)
    ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_SELECT_WORKSPACE)
    ipcMain.removeHandler(IPC_CHANNELS.PERMISSION_GRANT_DELETE)
  })
}

function validateProvider(provider: ProviderConfig): ProviderConfig {
  const id = provider?.id?.trim()
  const name = provider?.name?.trim()
  const baseUrl = provider?.baseUrl?.trim()
  const api = provider?.api?.trim()

  if (
    !provider ||
    !id ||
    (name !== undefined && !name) ||
    (baseUrl !== undefined && !isValidHttpUrl(baseUrl)) ||
    (api !== undefined && !api) ||
    (!hasBuiltinProvider(id) && !baseUrl) ||
    (provider.models !== undefined && !Array.isArray(provider.models))
  ) {
    throw new Error('提供商配置无效，请检查提供商 ID 和 API 地址')
  }

  const models = (provider.models ?? []).map(validateProviderModel)
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new Error('不能重复添加同一个提供商模型')
  }

  return {
    id,
    ...(name ? { name } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(api ? { api } : {}),
    ...(models.length ? { models } : {}),
  }
}

function validateProviderModel(model: ProviderModelConfig): ProviderModelConfig {
  const id = model?.id?.trim()
  const name = model?.name?.trim()
  const api = model?.api?.trim()

  if (
    !model ||
    !id ||
    (name !== undefined && !name) ||
    (api !== undefined && !api) ||
    (model.reasoning !== undefined && typeof model.reasoning !== 'boolean') ||
    (model.input !== undefined &&
      (!Array.isArray(model.input) ||
        model.input.length === 0 ||
        model.input.some((input) => input !== 'text' && input !== 'image'))) ||
    (model.contextWindow !== undefined && !isPositiveInteger(model.contextWindow)) ||
    (model.maxTokens !== undefined && !isPositiveInteger(model.maxTokens))
  ) {
    throw new Error('自定义模型配置无效，请检查模型 ID 和模型参数')
  }

  return {
    id,
    ...(name ? { name } : {}),
    ...(api ? { api } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.input ? { input: [...model.input] } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
  }
}

function validateModel(model: SavedModelConfig) {
  const provider = model?.provider?.trim()
  const modelID = model?.modelID?.trim()
  const baseUrl = model?.baseUrl?.trim()
  const isBuiltin = provider && modelID ? hasBuiltinModel(provider, modelID) : false
  const isBuiltinProvider = provider ? hasBuiltinProvider(provider) : false

  if (
    !model ||
    !provider ||
    !modelID ||
    typeof model.id !== 'string' ||
    model.id !== modelConfigId(provider, modelID) ||
    !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
      model.thinkingLevel ?? 'medium',
    ) ||
    (!isBuiltin && !isBuiltinProvider && !baseUrl) ||
    (baseUrl !== undefined && !isValidHttpUrl(baseUrl)) ||
    (model.api !== undefined && (typeof model.api !== 'string' || !model.api.trim())) ||
    (model.providerName !== undefined &&
      (typeof model.providerName !== 'string' || !model.providerName.trim())) ||
    (model.modelName !== undefined &&
      (typeof model.modelName !== 'string' || !model.modelName.trim())) ||
    (model.reasoning !== undefined && typeof model.reasoning !== 'boolean') ||
    (model.input !== undefined &&
      (!Array.isArray(model.input) ||
        model.input.length === 0 ||
        model.input.some((input) => input !== 'text' && input !== 'image'))) ||
    (model.contextWindow !== undefined && !isPositiveInteger(model.contextWindow)) ||
    (model.maxTokens !== undefined && !isPositiveInteger(model.maxTokens))
  ) {
    throw new Error('模型配置无效，请检查提供商、API 地址和模型信息')
  }
  return {
    id: modelConfigId(provider, modelID),
    provider,
    modelID,
    thinkingLevel: model.thinkingLevel ?? 'medium',
    ...(baseUrl ? { baseUrl } : {}),
    ...(model.providerName?.trim() ? { providerName: model.providerName.trim() } : {}),
    ...(model.modelName?.trim() ? { modelName: model.modelName.trim() } : {}),
    ...(model.api?.trim() ? { api: model.api.trim() } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.input ? { input: [...model.input] } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
