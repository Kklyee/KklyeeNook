import { utilityProcess } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AgentBackendProcess } from './process'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function createAgentBackendProcess(): AgentBackendProcess {
  return new AgentBackendProcess(
    join(__dirname, 'agent-backend-entry.mjs'),
    (entryPath) =>
      utilityProcess.fork(entryPath, [], {
        serviceName: 'KklyeeNook Agent Backend',
      }),
  )
}
