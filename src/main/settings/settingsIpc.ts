import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type {
  AgentSettingsSnapshot,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import { IPC_CHANNELS } from '@/shared/ipc/channels'
import type { ApprovalPolicy } from '../approval/approvalPolicy'
import type { CredentialStore } from './credentialStore'
import type { DeletePermissionGrantRequest } from '@/shared/approval/approvalTypes'
import type { AgentConfigStore } from './agentConfigStore'
import { getActiveModel, modelConfigId } from '@/shared/agent/agentConfig'
import { getModelCatalog, hasBuiltinModel } from './modelCatalog'

export function registerSettingsIpc(
  window: BrowserWindow,
  configStore: AgentConfigStore,
  credentials: CredentialStore,
  policy: ApprovalPolicy,
  onSettingsChanged: () => void,
) {
  const assertTrustedSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('不允许读取配置')
    }
  }

  const snapshot = async (): Promise<AgentSettingsSnapshot> => {
    const config = configStore.get()
    if (!config.cwd) throw new Error('Agent workspace is not configured')
    const catalog = getModelCatalog()
    const activeModel = getActiveModel(config)
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
      models: (config.models ?? [activeModel]).map((model) => ({
        ...model,
        providerName: providerNames.get(model.provider) ?? model.provider,
        modelName: modelNames.get(`${model.provider}:${model.modelID}`) ?? model.modelID,
        hasApiKey: credentials.hasApiKey(model.provider),
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
        !Array.isArray(request.models) ||
        typeof request.activeModelId !== 'string' ||
        typeof request.cwd !== 'string' ||
        request.models.length === 0
      ) {
        throw new Error('Agent 设置格式无效')
      }
      const current = configStore.get()
      const cwd = resolve(request.cwd.trim())
      if (!request.cwd.trim() || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
        throw new Error('Workspace 必须是一个存在的目录')
      }
      const models = request.models.map(validateModel)
      if (new Set(models.map((model) => model.id)).size !== models.length) {
        throw new Error('不能重复添加同一个模型')
      }
      const activeModel = models.find((model) => model.id === request.activeModelId)
      if (!activeModel) throw new Error('默认模型不在已保存的配置中')

      onSettingsChanged()
      configStore.set({
        ...current,
        cwd,
        models,
        activeModelId: activeModel.id,
        model: activeModel,
      })
      if (request.credential?.deleteApiKey) {
        credentials.deleteApiKey(request.credential.provider)
      } else if (request.credential?.apiKey?.trim()) {
        credentials.setApiKey(request.credential.provider, request.credential.apiKey.trim())
      }
      return snapshot()
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
    ipcMain.removeHandler(IPC_CHANNELS.SETTINGS_SELECT_WORKSPACE)
    ipcMain.removeHandler(IPC_CHANNELS.PERMISSION_GRANT_DELETE)
  })
}

function validateModel(model: UpdateAgentSettingsRequest['models'][number]) {
  if (
    !model ||
    typeof model.id !== 'string' ||
    typeof model.provider !== 'string' ||
    typeof model.modelID !== 'string' ||
    model.id !== modelConfigId(model.provider, model.modelID) ||
    !['off', 'low', 'medium', 'high'].includes(model.thinkingLevel ?? 'medium') ||
    !hasBuiltinModel(model.provider, model.modelID)
  ) {
    throw new Error('模型配置无效，请从内置目录中选择')
  }
  return {
    id: model.id.trim(),
    provider: model.provider,
    modelID: model.modelID,
    thinkingLevel: model.thinkingLevel ?? 'medium',
    ...(model.baseUrl?.trim() ? { baseUrl: model.baseUrl.trim() } : {}),
  }
}
