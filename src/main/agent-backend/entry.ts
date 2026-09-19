import { createAgentBackend, type AgentBackendRuntime } from './bootstrap'
import type { AgentBackendRequest, MainToAgentBackendMessage } from './protocol'

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
      backend = await createAgentBackend(message.options)
      parentPort?.postMessage({
        type: 'ready',
        info: { baseUrl: backend.baseUrl },
      })
    } catch {
      parentPort?.postMessage({ type: 'failed', message: 'Agent backend failed to initialize.' })
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
    } catch {
      parentPort?.postMessage({
        type: 'response',
        id: message.id,
        ok: false,
        message: 'Agent backend request failed.',
      })
    }
  }
}
