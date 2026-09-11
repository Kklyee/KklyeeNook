import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentRuntime } from '../../agentRuntime'
import { convertPiEvent } from '../adapters/piEventAdapter'
import type { PiSessionHostLike } from './piSessionHost'

type Emit = (event: AgentEvent) => void

export class PiAgentRuntime implements AgentRuntime {
  constructor(
    private readonly host: PiSessionHostLike,
    private readonly disposeHost: () => void,
  ) {}

  async run(prompt: string, emit: Emit, signal?: AbortSignal): Promise<void> {
    let unsubscribe: (() => void) | undefined
    let unsubscribeProductEvents: (() => void) | undefined
    let terminalEventReceived = false

    const handleAbort = () => {
      void this.host.cancel()
    }

    try {
      await this.host.initialize()
      emit({ type: 'system_prompt', text: this.host.getSystemPrompt() })
      unsubscribe = this.host.subscribe((piEvent) => {
        const agentEvent = convertPiEvent(piEvent)
        if (!agentEvent) return

        if (agentEvent.type === 'agent_failed' || agentEvent.type === 'agent_aborted') {
          terminalEventReceived = true
        }
        emit(agentEvent)
      })
      unsubscribeProductEvents = this.host.subscribeProductEvents(emit)

      if (signal?.aborted) {
        emit({ type: 'agent_aborted' })
        return
      }

      signal?.addEventListener('abort', handleAbort, { once: true })
      await this.host.runMessage({ content: prompt })

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
    await this.host.cancel()
  }

  dispose(): void {
    this.disposeHost()
  }
}
