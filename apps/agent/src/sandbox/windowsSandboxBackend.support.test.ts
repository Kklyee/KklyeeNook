import { spawnSync } from 'node:child_process'
import { beforeEach, expect, test, vi } from 'vitest'
import { WindowsSandboxBackend } from './windowsSandboxBackend'

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }))

beforeEach(() => vi.resetAllMocks())

test.each([
  [0, 'partial'],
  [125, 'unavailable'],
  [null, 'unavailable'],
] as const)('caches probe status %s as %s', (status, support) => {
  const probe = vi
    .mocked(spawnSync)
    .mockReturnValue({
      status,
      pid: 0,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      signal: null,
    })
  const backend = new WindowsSandboxBackend('data', 'helper.exe')
  expect(backend.support()).toBe(support)
  expect(backend.support()).toBe(support)
  expect(probe).toHaveBeenCalledExactlyOnceWith(
    'helper.exe',
    ['--check-enforcement'],
    expect.objectContaining({ windowsHide: true, timeout: 5000 }),
  )
})
