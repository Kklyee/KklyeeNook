import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'

import { AgentConfigStore } from './agentConfigStore'

test('defaults to workspace tools and the supported agent helpers', () => {
  expect(new AgentConfigStore().get().tools.enabled).toEqual([
    'read', 'bash', 'edit', 'write', 'find', 'grep', 'update_plan', 'save_memory', 'delegate_task',
    'search_knowledge', 'read_knowledge',
  ])
})

const directory = mkdtempSync(join(tmpdir(), 'kklyeenook-config-'))
afterAll(() => rmSync(directory, { recursive: true }))

test('persists agent settings without exposing mutable store state', () => {
  const path = join(directory, 'settings.json')
  const initial = {
    model: { provider: 'test', modelID: 'first', thinkingLevel: 'off' as const },
    tools: { enabled: ['read'] },
    cwd: directory,
    compaction: { enabled: false, reserveTokens: 2_048, keepRecentTokens: 4_096 },
    mcpServers: [
      {
        id: 'filesystem',
        name: 'Filesystem',
        enabled: true,
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', directory],
        cwd: directory,
        env: { MCP_TEST: 'value with spaces' },
        disabledTools: ['delete_file'],
      },
    ],
  }
  const store = new AgentConfigStore(initial, path)
  const updated = store.get()
  updated.model.modelID = 'second'
  expect(store.get().model.modelID).toBe('first')

  store.set(updated)
  const restored = new AgentConfigStore(initial, path)
  expect(restored.get().model.modelID).toBe('second')
  expect(restored.get().compaction).toEqual({
    enabled: false,
    reserveTokens: 2_048,
    keepRecentTokens: 4_096,
  })
  expect(restored.get().mcpServers).toEqual(initial.mcpServers)
  expect(JSON.parse(readFileSync(path, 'utf8')).cwd).toBeUndefined()
  expect(restored.get().cwd).toBeUndefined()
})
