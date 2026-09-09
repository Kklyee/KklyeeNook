import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession as PiAgentSession,
} from '@earendil-works/pi-coding-agent'

import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { CredentialStore } from '@/main/settings/credentialStore'
import { resolveBuiltinTools } from '@/main/tools/builtinTools'
import type { ApprovalService } from '@/main/approval/approvalService'
import type { ApprovalPolicy } from '@/main/approval/approvalPolicy'
import { createPiApprovalExtension } from '@/main/approval/piApprovalExtension'
import type { AgentRuntime } from '../agentRuntime'
import { convertPiEvent } from './piEventAdapter'
type Emit = (event: AgentEvent) => void

interface PIAgentApprovalDeps {
  approvalService: ApprovalService
  approvalPolicy: ApprovalPolicy
}

export class PiAgentRuntime implements AgentRuntime {
  private session: PiAgentSession | null = null

  constructor(
    private readonly configStore: AgentConfigStore,
    private readonly credentialStore: CredentialStore,
    private readonly approval: PIAgentApprovalDeps,
  ) {}

  async initialize() {
    if (this.session) {
      return
    }

    const config = this.configStore.get()
    const { provider, modelID, thinkingLevel, baseUrl } = config.model

    const apiKey = this.credentialStore.getApiKey(provider)
    if (!apiKey) {
      throw new Error(`Provider "${provider}" 没有配置 API Key`)
    }
    try {
      const modelRuntime = await ModelRuntime.create()
      if (baseUrl) {
        modelRuntime.registerProvider(provider, {
          name: 'B.AI',
          baseUrl,
          api: 'openai-completions',
          authHeader: true,
          models: [
            {
              id: modelID,
              name: modelID,
              reasoning: false,
              input: ['text'],
              contextWindow: 128_000,
              maxTokens: 1_000,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              samplingParams: { temperature: 0.7 },
              compat: {
                maxTokensField: 'max_tokens',
                supportsUsageInStreaming: false,
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
              },
            },
          ],
        })
      }
      await modelRuntime.setRuntimeApiKey(provider, apiKey)
      const model = modelRuntime.getModel(provider, modelID)

      if (!model) {
        throw new Error(`找不到模型: ${provider}/${modelID}`)
      }

      const cwd = config.cwd ?? process.cwd()
      const tools = resolveBuiltinTools(config.tools.enabled)

      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: cwd,
        extensionFactories: [
          createPiApprovalExtension(this.approval.approvalService, this.approval.approvalPolicy),
        ],
      })
      await resourceLoader.reload()

      const { session } = await createAgentSession({
        cwd,
        modelRuntime,
        model,
        thinkingLevel: thinkingLevel ?? 'medium',
        tools,
        resourceLoader,
        sessionManager: SessionManager.inMemory(cwd),
      })
      this.session = session
      console.log('[PiAgentRuntime] session created')
      console.log('[PiAgentRuntime] model:', `${provider}/${modelID}`)
      console.log('[PiAgentRuntime] tools:', tools)
    } catch (e) {
      console.error('[PiAgentRuntime] failed to create session:', e)
      throw e
    }
  }

  getSession(): PiAgentSession {
    if (!this.session) {
      throw new Error('Session is not initialized')
    }
    return this.session
  }
  async run(prompt: string, emit: Emit, signal?: AbortSignal) {
    let session: PiAgentSession | undefined
    let unsubscribe: (() => void) | undefined
    let terminalEventReceived = false

    const handleAbort = () => {
      session?.agent.abort()
    }

    try {
      await this.initialize()
      session = this.getSession()
      unsubscribe = session.subscribe((piEvent) => {
        const agentEvent = convertPiEvent(piEvent)

        if (agentEvent) {
          if (agentEvent.type === 'agent_failed' || agentEvent.type === 'agent_aborted') {
            terminalEventReceived = true
          }
          emit(agentEvent)
        }
      })

      if (signal?.aborted) {
        emit({ type: 'agent_aborted' })
        return
      }

      signal?.addEventListener('abort', handleAbort, { once: true })
      await session.prompt(prompt)

      if (terminalEventReceived) {
        return
      }

      if (signal?.aborted) {
        emit({ type: 'agent_aborted' })
        return
      }

      emit({ type: 'agent_completed' })
    } catch (error) {
      if (signal?.aborted) {
        emit({ type: 'agent_aborted' })
        return
      }

      emit({ type: 'agent_failed', error: error instanceof Error ? error.message : String(error) })
    } finally {
      unsubscribe?.()
      signal?.removeEventListener('abort', handleAbort)
    }
  }

  async abort() {
    await this.session?.abort()
  }

  dispose() {
    this.session?.dispose()
    this.session = null
  }
}
