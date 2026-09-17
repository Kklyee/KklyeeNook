import type { ModelCatalogModel } from '@/shared/agent/agentSettings'
import { modelCatalogDefaults } from './modelCatalog'

const DEFAULT_API = 'openai-completions'
const DEFAULT_THINKING_LEVELS = ['off'] as const
const REASONING_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export interface DiscoverRemoteModelsOptions {
  baseUrl: string
  api?: string
  apiKey?: string
  fetchImpl?: typeof fetch
}

/**
 * Discover models exposed by OpenAI-compatible endpoints. The returned values
 * are deliberately conservative: providers may omit capabilities from /models,
 * so users can still override them when saving the model.
 */
export async function discoverRemoteModels({
  baseUrl,
  api,
  apiKey,
  fetchImpl = fetch,
}: DiscoverRemoteModelsOptions): Promise<ModelCatalogModel[]> {
  const endpoint = toModelsEndpoint(baseUrl)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`

  const response = await fetchImpl(endpoint, { headers })
  if (!response.ok) {
    throw new Error(`获取模型目录失败（HTTP ${response.status}）`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('模型目录返回的不是有效 JSON')
  }

  return parseDiscoveredModels(payload, api ?? DEFAULT_API)
}

export function parseDiscoveredModels(payload: unknown, api = DEFAULT_API): ModelCatalogModel[] {
  const candidates = extractModelArray(payload)
  const models: ModelCatalogModel[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const value = candidate as Record<string, unknown>
    const id = typeof value.id === 'string' ? value.id.trim() : ''
    if (!id || seen.has(id)) continue

    const reasoning = value.reasoning === true
    const contextWindow = positiveNumber(value.context_window) ?? modelCatalogDefaults.contextWindow
    const maxTokens =
      positiveNumber(value.max_tokens) ??
      positiveNumber(value.max_output_tokens) ??
      modelCatalogDefaults.maxTokens
    const input: ModelCatalogModel['input'] = Array.isArray(value.input)
      ? value.input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
      : ['text']

    seen.add(id)
    models.push({
      id,
      name: stringValue(value.name) ?? stringValue(value.display_name) ?? id,
      api,
      reasoning,
      input: input.length ? input : ['text'],
      availableThinkingLevels: [
        ...(reasoning ? REASONING_THINKING_LEVELS : DEFAULT_THINKING_LEVELS),
      ],
      contextWindow,
      maxTokens,
      builtin: false,
    })
  }

  if (!models.length) throw new Error('模型目录中没有可用模型')
  return models
}

export function toModelsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) throw new Error('获取模型目录前必须填写 API 地址')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('API 地址无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('API 地址必须使用 http 或 https')
  }

  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/models`
  return url.toString()
}

function extractModelArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []

  const value = payload as Record<string, unknown>
  if (Array.isArray(value.data)) return value.data
  if (Array.isArray(value.models)) return value.models
  return []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
