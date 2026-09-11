import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession as PiAgentSession,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'

import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentConfigStore } from '@/main/settings/agentConfigStore'
import type { CredentialStore } from '@/main/settings/credentialStore'
import type { ToolRegistry } from '@/main/tools/toolRegistry'
import type { ApprovalService } from '@/main/approval/approvalService'
import type { ApprovalPolicy } from '@/main/approval/approvalPolicy'
import { createPiApprovalExtension } from '@/main/approval/piApprovalExtension'
import type { AgentRuntime } from '../agentRuntime'
import { convertPiEvent } from './piEventAdapter'
import { AgentRuntimeStateRepo } from '@/main/db/repo/agentRuntimeStateRepo'
import { existsSync } from 'node:fs'
type Emit = (event: AgentEvent) => void

interface PIAgentApprovalDeps {
  approvalService: ApprovalService
  approvalPolicy: ApprovalPolicy
}

export class PiAgentRuntime implements AgentRuntime {
  private session: PiAgentSession | null = null
  private activeEmit: Emit | undefined

  constructor(
    private readonly sessionId: string,
    private readonly configStore: AgentConfigStore,
    private readonly credentialStore: CredentialStore,
    private readonly approval: PIAgentApprovalDeps,
    private readonly runtimeStateRepo: AgentRuntimeStateRepo,
    private readonly toolRegistry: ToolRegistry,
    private readonly sessionDir: string,
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
      const tools = this.toolRegistry.resolve<PiToolDefinition<any, any, any>>(
        'pi',
        config.tools.enabled,
        { cwd },
      )

      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: cwd,
        extensionFactories: [
          createPiApprovalExtension(
            this.sessionId,
            this.approval.approvalService,
            this.approval.approvalPolicy,
            (event) => this.activeEmit?.(event),
          ),
        ],
      })
      await resourceLoader.reload()
      const sessionManager = await this.createSessionManager(cwd)
      const { session } = await createAgentSession({
        cwd,
        modelRuntime,
        model,
        thinkingLevel: thinkingLevel ?? 'medium',
        noTools: 'builtin',
        tools: config.tools.enabled,
        customTools: tools,
        resourceLoader,
        sessionManager,
      })
      this.session = session
      if (session.sessionId !== this.sessionId) {
        session.dispose()
        throw new Error(
          `Pi session ID mismatch: expected ${this.sessionId}, got ${session.sessionId}`,
        )
      }

      const resumeRef = session.sessionFile

      if (!resumeRef) {
        session.dispose()
        throw new Error('Persistent Pi session did not provide a session file')
      }

      await this.runtimeStateRepo.save({
        sessionId: this.sessionId,
        runtimeKind: 'pi',
        resumeRef,
        updatedAt: Date.now(),
      })
      console.log('[PiAgentRuntime] session created')
      console.log('[PiAgentRuntime] model:', `${provider}/${modelID}`)
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
      this.activeEmit = emit
      await this.initialize()
      session = this.getSession()
      emit({ type: 'system_prompt', text: session.systemPrompt })
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
      this.activeEmit = undefined
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

  private async createSessionManager(cwd: string): Promise<SessionManager> {
    const state = await this.runtimeStateRepo.findBySessionId(this.sessionId)

    if (!state) {
      console.log('[PiAgentRuntime] create persistent session', { sessionId: this.sessionId })
      return SessionManager.create(cwd, this.sessionDir, { id: this.sessionId })
    }

    if (state.runtimeKind !== 'pi') {
      throw new Error(`Unsupported runtime kind: ${state.runtimeKind}`)
    }

    if (!existsSync(state.resumeRef)) {
      console.warn('[PiAgentRuntime] resume file missing, creating a new Pi session', {
        sessionId: this.sessionId,
        resumeRef: state.resumeRef,
      })

      return SessionManager.create(cwd, this.sessionDir, { id: this.sessionId })
    }

    console.log('[PiAgentRuntime] resume persistent session', {
      sessionId: this.sessionId,
      resumeRef: state.resumeRef,
    })

    const manager = SessionManager.open(state.resumeRef, this.sessionDir, cwd)

    if (manager.getSessionId() !== this.sessionId) {
      throw new Error(
        `Pi session mismatch: expected ${this.sessionId}, got ${manager.getSessionId()}`,
      )
    }

    return manager
  }
}
