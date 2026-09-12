import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentRuntime } from '../../agentRuntime'
import { convertPiEvent } from '../adapters/piEventAdapter'
import type { PiSessionRuntimePort } from './piSessionRuntime'

type Emit = (event: AgentEvent) => void

export class PiAgentRuntime implements AgentRuntime {
  constructor(
    private readonly sessionRuntime: PiSessionRuntimePort,
    private readonly disposeRuntime: () => void,
  ) {}

  async run(prompt: string, emit: Emit, signal?: AbortSignal): Promise<void> {
    let unsubscribe: (() => void) | undefined
    let unsubscribeProductEvents: (() => void) | undefined
    let terminalEventReceived = false

    const handleAbort = () => {
      void this.sessionRuntime.cancel()
    }

    try {
      await this.sessionRuntime.initialize()
      emit({ type: 'system_prompt', text: this.sessionRuntime.getSystemPrompt() })
      unsubscribe = this.sessionRuntime.subscribe((piEvent) => {
        const agentEvent = convertPiEvent(piEvent)
        if (!agentEvent) return

        if (agentEvent.type === 'agent_failed' || agentEvent.type === 'agent_aborted') {
          terminalEventReceived = true
        }
        emit(agentEvent)
      })
      unsubscribeProductEvents = this.sessionRuntime.subscribeProductEvents(emit)

      if (signal?.aborted) {
        emit({ type: 'agent_aborted' })
        return
      }

      signal?.addEventListener('abort', handleAbort, { once: true })
      await this.sessionRuntime.runMessage({ content: prompt })

      if (terminalEventReceived) return
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
      unsubscribeProductEvents?.()
      unsubscribe?.()
      signal?.removeEventListener('abort', handleAbort)
    }
  }

  async abort(): Promise<void> {
    await this.sessionRuntime.cancel()
  }

  dispose(): void {
    this.disposeRuntime()
  }
}
