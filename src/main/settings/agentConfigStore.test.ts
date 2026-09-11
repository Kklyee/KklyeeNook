import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'

import { AgentConfigStore } from './agentConfigStore'

const directory = mkdtempSync(join(tmpdir(), 'kklyeenook-config-'))
afterAll(() => rmSync(directory, { recursive: true }))

test('persists agent settings without exposing mutable store state', () => {
  const path = join(directory, 'settings.json')
  const initial = {
    model: { provider: 'test', modelID: 'first', thinkingLevel: 'off' as const },
    tools: { enabled: ['read'] },
    cwd: directory,
  }
  const store = new AgentConfigStore(initial, path)
  const updated = store.get()
  updated.model.modelID = 'second'
  expect(store.get().model.modelID).toBe('first')

  store.set(updated)
  const restored = new AgentConfigStore(initial, path)
  expect(restored.get().model.modelID).toBe('second')
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ cwd: directory })
})
