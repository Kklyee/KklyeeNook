import { createAgentBackend, type AgentBackendRuntime } from './bootstrap'
import type {
  AgentBackendRequest,
  AgentBackendStartupStage,
  AgentBackendToMainMessage,
  MainToAgentBackendMessage,
} from './protocol'

const parentPort = process.parentPort
let backend: AgentBackendRuntime | undefined

if (!parentPort) throw new Error('Agent backend must run as an Electron utility process')

parentPort.on('message', (event) => {
  void handleMessage(event.data as MainToAgentBackendMessage)
})

async function handleMessage(message: MainToAgentBackendMessage): Promise<void> {
  if (message.type === 'initialize') {
    if (backend) return
    try {
      backend = await createAgentBackend(
        message.options,
        (stage, detail) => {
          postStartupStage(stage, detail)
        },
        (notification) => parentPort?.postMessage({ type: 'notification', notification }),
      )
      postStartupStage('ready')
      parentPort?.postMessage({
        type: 'ready',
        info: { baseUrl: backend.baseUrl },
      })
    } catch (error) {
      const errorMessage = formatError(error)
      console.error('[agent-backend] failed to initialize', errorMessage)
      parentPort?.postMessage({ type: 'failed', message: errorMessage })
      process.exit(1)
    }
    return
  }

  if (message.type === 'shutdown') {
    try {
      await backend?.close()
    } finally {
      process.exit(0)
    }
  }

  if (message.type === 'request') {
    try {
      if (!backend) throw new Error('Agent backend is unavailable')
      const value = await backend.handleRequest(message as AgentBackendRequest)
      parentPort?.postMessage({ type: 'response', id: message.id, ok: true, value })
    } catch (error) {
      console.error('[agent-backend] request failed', formatError(error))
      parentPort?.postMessage({
        type: 'response',
        id: message.id,
        ok: false,
        message: 'Agent backend request failed.',
      })
    }
  }
}

function postStartupStage(stage: AgentBackendStartupStage, detail?: string): void {
  const message: AgentBackendToMainMessage = {
    type: 'startup-stage',
    stage,
    ...(detail ? { detail } : {}),
  }
  parentPort?.postMessage(message)
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}
