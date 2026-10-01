import type { AgentEvent } from '@/shared/agent/agentEvent'
import type { AgentRuntime, AgentRuntimeInput, AgentRuntimeEvent } from '../../agentRuntime'
import { convertPiEvent } from '../adapters/piEventAdapter'
import type { PiSessionRuntimePort } from './piSessionRuntime'

type Emit = (event: AgentRuntimeEvent) => void

export class PiAgentRuntime implements AgentRuntime {
  constructor(
    private readonly sessionRuntime: PiSessionRuntimePort,
    private readonly disposeRuntime: () => void,
  ) {}

  async run(input: AgentRuntimeInput, emit: Emit, signal?: AbortSignal): Promise<void> {
    let unsubscribe: (() => void) | undefined
    let unsubscribeProductEvents: (() => void) | undefined
    let unsubscribeExecutionEvents: (() => void) | undefined
    let terminalEvent: AgentEvent | undefined
    let settled = false

    const handleAbort = () => {
      void this.sessionRuntime.cancel()
    }
    const finish = (event: AgentEvent) => {
      if (event.type === 'agent_failed' || event.type === 'agent_aborted') this.sessionRuntime.clearQueue()
      emit(event)
    }

    try {
      await this.sessionRuntime.initialize()
      emit({ type: 'system_prompt', text: this.sessionRuntime.getSystemPrompt() })
      emit({ type: 'agent_started' })
      unsubscribe = this.sessionRuntime.subscribe((piEvent) => {
        const agentEvent = convertPiEvent(piEvent)
        if (piEvent.type === 'agent_end') terminalEvent = agentEvent
        if (!agentEvent) return
        if (['agent_started', 'agent_failed', 'agent_aborted'].includes(agentEvent.type)) return
        emit(agentEvent)
      })
      unsubscribeProductEvents = this.sessionRuntime.subscribeProductEvents(emit)
      unsubscribeExecutionEvents = this.sessionRuntime.subscribeExecutionEvents((event) => {
        emit(event)
        if (event.type === 'pi_agent_settled') {
          settled = true
          finish(signal?.aborted ? { type: 'agent_aborted' } : terminalEvent ?? { type: 'agent_completed' })
        }
      })

      if (signal?.aborted) {
        finish({ type: 'agent_aborted' })
        return
      }

      signal?.addEventListener('abort', handleAbort, { once: true })
      const runInput = input.attachments?.length
        ? { content: input.prompt, attachments: input.attachments }
        : { content: input.prompt }
      if (input.runId !== undefined && input.skillIds?.length) {
        await this.sessionRuntime.runMessage(runInput, input.context, input.skillIds, input.runId)
      } else if (input.runId !== undefined) {
        await this.sessionRuntime.runMessage(runInput, input.context, undefined, input.runId)
      } else if (input.skillIds?.length) {
        await this.sessionRuntime.runMessage(runInput, input.context, input.skillIds)
      } else {
        await this.sessionRuntime.runMessage(runInput, input.context)
      }

      if (settled) return
      if (signal?.aborted) {
        finish({ type: 'agent_aborted' })
        return
      }
      finish(terminalEvent ?? { type: 'agent_completed' })
    } catch (error) {
      if (settled) return
      if (signal?.aborted) {
        finish({ type: 'agent_aborted' })
        return
      }
      finish({ type: 'agent_failed', error: error instanceof Error ? error.message : String(error) })
    } finally {
      unsubscribeProductEvents?.()
      unsubscribeExecutionEvents?.()
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
