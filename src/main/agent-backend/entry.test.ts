import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AgentBackendProcess, type UtilityProcessLike } from './process'
import type { AgentBackendInitOptions, AgentBackendRequest } from './protocol'

const { handleRequest, createAgentBackend } = vi.hoisted(() => {
  const handleRequest = vi.fn()
  return {
    handleRequest,
    createAgentBackend: vi.fn(async () => ({
      baseUrl: 'http://127.0.0.1:12345/api/pi',
      handleRequest,
    })),
  }
})

vi.mock('./bootstrap', () => ({ createAgentBackend }))

class LoopbackUtilityProcess extends EventEmitter implements UtilityProcessLike {
  readonly port = Object.assign(new EventEmitter(), {
    postMessage: (message: unknown) => this.emit('message', message),
  })
  postMessage(message: unknown): void {
    this.port.emit('message', { data: message })
  }
  kill(): boolean {
    this.emit('exit', 0)
    return true
  }
}

const originalParentPort = Object.getOwnPropertyDescriptor(process, 'parentPort')
let child: LoopbackUtilityProcess
let backend: AgentBackendProcess

beforeEach(async () => {
  vi.resetModules()
  handleRequest.mockReset()
  child = new LoopbackUtilityProcess()
  Object.defineProperty(process, 'parentPort', { configurable: true, value: child.port })
  await import('./entry')
  backend = new AgentBackendProcess('/agent-backend-entry.mjs', () => {
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
  await backend.start({} as AgentBackendInitOptions)
})

afterEach(() => {
  child.emit('exit', 0)
  child.port.removeAllListeners()
  if (originalParentPort) Object.defineProperty(process, 'parentPort', originalParentPort)
  else Reflect.deleteProperty(process, 'parentPort')
  vi.restoreAllMocks()
})

test('permission requests keep the conversation id and return through the utility entry', async () => {
  handleRequest.mockImplementation(async (request: AgentBackendRequest) => request.action)
  const permission = {
    action: 'conversation:permission' as const,
    id: 'conversation-1',
    mode: 'full-access' as const,
  }
  await expect(backend.request(permission, 100)).resolves.toBe('conversation:permission')
  expect(handleRequest).toHaveBeenCalledWith(expect.objectContaining(permission))
})

test('a failed permission request returns an error instead of timing out', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  handleRequest.mockRejectedValue(new Error('Permission update rejected'))
  await expect(
    backend.request(
      { action: 'conversation:permission', id: 'conversation-1', mode: 'full-access' },
      100,
    ),
  ).rejects.toThrow('Agent backend request failed.')
})
