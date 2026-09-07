import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent'

import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { CredentialStore } from '@/main/settings/credentialStore'
import { convertPIEvent } from './PIEventAdapter'
import { resolveBuiltinTools } from '../tools/toolRegistry'
import { ApprovalService } from '../approval/approvalService'
import { ApprovalPolicy } from '../approval/approvalPolicy'
import { createApprovalExtension } from '../approval/approvalExtension'
type Emit = (event: AgentEvent) => void

interface PIAgentApprovalDeps {
  approvalService: ApprovalService
  approvalPolicy: ApprovalPolicy
}

export class PIAgentAdapter {
  private session: AgentSession | null = null

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
          createApprovalExtension(this.approval.approvalService, this.approval.approvalPolicy),
        ],
      })

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
      console.log('[PIAgentAdapter] session created')
      console.log('[PIAgentAdapter] model:', `${provider}/${modelID}`)
      console.log('[PIAgentAdapter] tools:', tools)
    } catch (e) {
      console.error('[PIAgentAdapter] failed to create session:', e)
    }
  }

  getSession(): AgentSession {
    if (!this.session) {
      throw new Error('Session is not initialized')
    }
    return this.session
  }
  async run(prompt: string, emit: Emit, signal?: AbortSignal) {
    await this.initialize()
    const session = this.getSession()

    const unsubscribe = session.subscribe((piEvent) => {
      const agentEvent = convertPIEvent(piEvent)

      if (agentEvent) {
        emit(agentEvent)
      }
    })

    const handleAbort = () => {
      session.agent.abort()
    }
    if (signal?.aborted) {
      unsubscribe()
      emit({ type: 'agent_aborted' })
      return
    }

    signal?.addEventListener('abort', handleAbort, { once: true })

    try {
      await session.prompt(prompt)

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
      unsubscribe()
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
