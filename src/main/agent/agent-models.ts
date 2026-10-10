import { envApiKeyAuth } from '@earendil-works/pi-ai'
import {
  clampThinkingLevel,
  createModels,
  createProvider,
  type MutableModels,
} from '@earendil-works/pi-ai/models'
import { applicationProviders } from '../settings/model-providers'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { azureOpenAIResponsesApi } from '@earendil-works/pi-ai/api/azure-openai-responses.lazy'
import { bedrockConverseStreamApi } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { googleVertexApi } from '@earendil-works/pi-ai/api/google-vertex.lazy'
import { mistralConversationsApi } from '@earendil-works/pi-ai/api/mistral-conversations.lazy'
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { piMessagesApi } from '@earendil-works/pi-ai/api/pi-messages.lazy'
import type {
  Api, AuthContext, CredentialStore as PiCredentials, Model, ProviderStreams,
} from '@earendil-works/pi-ai'
import type { AgentChange } from '@earendil-works/pi-durable'
import {
  getActiveModel,
  getConfiguredProviders,
  getSavedModels,
  type AgentConfig,
  type ProviderConfig,
  type ProviderModelConfig,
} from '@/shared/agent/agentConfig'
import { resolveModelInput } from '@/shared/agent/modelCapabilities'
import type { CredentialStore } from '../settings/credentialStore'

const apis: Record<string, () => ProviderStreams> = {
  'anthropic-messages': anthropicMessagesApi,
  'azure-openai-responses': azureOpenAIResponsesApi,
  'bedrock-converse-stream': bedrockConverseStreamApi,
  'google-generative-ai': googleGenerativeAIApi,
  'google-vertex': googleVertexApi,
  'mistral-conversations': mistralConversationsApi,
  'openai-codex-responses': openAICodexResponsesApi,
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'pi-messages': piMessagesApi,
}

export class AgentModels {
  readonly models: MutableModels
  private readonly writes = new Map<string, Promise<unknown>>()

  constructor(
    private readonly config: () => AgentConfig,
    private readonly credentials: () => CredentialStore,
    authContext?: AuthContext,
  ) {
    const read: PiCredentials['read'] = async (id, options) => {
      options?.signal?.throwIfAborted()
      const key = this.credentials().getApiKey(id)
      return key ? { type: 'api_key', key } : undefined
    }
    const store: PiCredentials = {
      read,
      list: async (options) => {
        options?.signal?.throwIfAborted()
        return this.models.getProviders().filter((provider) => this.credentials().hasApiKey(provider.id))
          .map((provider) => ({ providerId: provider.id, type: 'api_key' as const }))
      },
      modify: (id, change, options) => this.serialize(id, async () => {
        options?.signal?.throwIfAborted()
        const current = await read(id, options)
        const next = await change(current)
        if (!next) return current
        if (next.type !== 'api_key' || !next.key) throw new Error('Only API key credentials are supported by application settings')
        this.credentials().setApiKey(id, next.key)
        return next
      }),
      delete: (id, options) => this.serialize(id, async () => {
        options?.signal?.throwIfAborted()
        this.credentials().deleteApiKey(id)
      }),
    }
    this.models = createModels({ credentials: store, authContext })
    this.reload()
  }

  selection(): AgentChange {
    const configured = getActiveModel(this.config())
    const model = this.models.getModel(configured.provider, configured.modelID)
    if (!model) throw new Error(`Model is not available: ${configured.provider}/${configured.modelID}`)
    return {
      model: { provider: configured.provider, modelId: configured.modelID },
      thinkingLevel: clampThinkingLevel(model, configured.thinkingLevel ?? 'off'),
    }
  }

  contextWindow(model: AgentChange['model']) {
    return model ? this.models.getModel(model.provider, model.modelId)?.contextWindow : undefined
  }

  reload() {
    const config = this.config()
    const providers = new Map(applicationProviders().map((provider) => [provider.id, provider]))
    const saved = getSavedModels(config)
    const configured = new Map(getConfiguredProviders(config).map((provider) => [provider.id, provider]))
    for (const profile of saved) {
      if (!configured.has(profile.provider)) configured.set(profile.provider, { id: profile.provider })
    }
    for (const provider of configured.values()) {
      const builtin = providers.get(provider.id)
      const models = new Map((builtin?.getModels() ?? []).map((model) => [model.id, model]))
      const definitions = new Map<string, ProviderModelConfig & { baseUrl?: string }>()
      for (const profile of saved.filter((profile) => profile.provider === provider.id)) {
        definitions.set(profile.modelID, {
          id: profile.modelID, name: profile.modelName, api: profile.api, baseUrl: profile.baseUrl,
          reasoning: profile.reasoning, input: profile.input,
          contextWindow: profile.contextWindow, maxTokens: profile.maxTokens,
        })
      }
      for (const model of provider.models ?? []) {
        definitions.set(model.id, { ...definitions.get(model.id), ...model })
      }
      if (provider.baseUrl || provider.api) {
        for (const model of models.values()) models.set(model.id, this.model(provider, { id: model.id }, model))
      }
      for (const definition of definitions.values()) {
        const template = models.get(definition.id) ?? builtin?.getModels()[0]
        models.set(definition.id, this.model(provider, definition, template))
      }
      if (!models.size) continue
      const list = [...models.values()]
      if (!builtin) {
        const implementations = this.implementations(list)
        providers.set(provider.id, createProvider({
          id: provider.id, name: provider.name, baseUrl: provider.baseUrl,
          auth: { apiKey: envApiKeyAuth(`${provider.name ?? provider.id} API key`, []) },
          models: list, api: implementations,
        }))
      } else {
        const known = new Set(builtin.getModels().map((model) => model.api))
        const overrides = this.implementations(list.filter((model) => !known.has(model.api)))
        providers.set(provider.id, {
          ...builtin,
          name: provider.name ?? builtin.name,
          baseUrl: provider.baseUrl ?? builtin.baseUrl,
          getModels: () => list,
          getAllModels: () => [...list, ...(builtin.getAllModels?.() ?? []).filter((model) => model.type && model.type !== 'chat')],
          stream: (model, context, options) =>
            overrides[model.api]?.stream(model, context, options) ?? builtin.stream(model, context, options),
          streamSimple: (model, context, options) =>
            overrides[model.api]?.streamSimple(model, context, options) ?? builtin.streamSimple(model, context, options),
        })
      }
    }
    this.models.clearProviders()
    for (const provider of providers.values()) this.models.setProvider(provider)
  }

  private model(provider: ProviderConfig, definition: ProviderModelConfig & { baseUrl?: string }, template?: Model<Api>): Model<Api> {
    const baseUrl = provider.baseUrl ?? definition.baseUrl ?? template?.baseUrl
    if (!baseUrl) throw new Error(`Provider ${provider.id} requires an API base URL`)
    const api = definition.api ?? provider.api ?? template?.api ?? 'openai-completions'
    return {
      ...template,
      id: definition.id, name: definition.name ?? (template?.id === definition.id ? template.name : definition.id),
      provider: provider.id, api, baseUrl,
      reasoning: definition.reasoning ?? template?.reasoning ?? false,
      input: resolveModelInput(provider.id, definition.id, definition.input ?? template?.input ?? ['text']),
      contextWindow: definition.contextWindow ?? template?.contextWindow ?? 128_000,
      maxTokens: definition.maxTokens ?? template?.maxTokens ?? 16_384,
      cost: template?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: template?.api === api ? template.compat : api === 'openai-completions' ? {
        maxTokensField: 'max_tokens', supportsUsageInStreaming: false,
        supportsDeveloperRole: false, supportsReasoningEffort: false,
      } : undefined,
    }
  }

  private implementations(models: Model<Api>[]) {
    return Object.fromEntries([...new Set(models.map((model) => model.api))].map((api) => {
      const create = apis[api]
      if (!create) throw new Error(`Unsupported model API: ${api}`)
      return [api, create()]
    }))
  }

  private serialize<T>(id: string, action: () => Promise<T>): Promise<T> {
    const pending = (this.writes.get(id) ?? Promise.resolve()).catch(() => undefined).then(action)
    this.writes.set(id, pending)
    void pending.finally(() => {
      if (this.writes.get(id) === pending) this.writes.delete(id)
    }).catch(() => undefined)
    return pending
  }
}
