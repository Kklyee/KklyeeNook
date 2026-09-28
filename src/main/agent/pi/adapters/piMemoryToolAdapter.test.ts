import { expect, test, vi } from 'vitest'

import type { AgentMemoryRepo } from '@/main/db/repositories/memoryRepo'
import { ToolRegistry } from '@/main/tools/toolRegistry'
import { createSaveMemoryToolDefinition, registerPiMemoryTool } from './piMemoryToolAdapter'

test('saves explicit memory content with the current workspace scope', async () => {
  const memory = {
    id: 'memory-1',
    scope: 'workspace' as const,
    content: 'Use pnpm',
    createdAt: 1,
    updatedAt: 1,
  }
  const repo: AgentMemoryRepo = {
    list: vi.fn(),
    create: vi.fn(async () => memory),
    update: vi.fn(),
    delete: vi.fn(),
  }
  const tool = createSaveMemoryToolDefinition(repo, 'C:/workspace')

  const result = await tool.execute(
    'call-1',
    { scope: 'workspace', content: 'Use pnpm' },
    undefined,
    undefined,
    {} as never,
  )

  expect(repo.create).toHaveBeenCalledWith({
    scope: 'workspace',
    content: 'Use pnpm',
    workspacePath: 'C:/workspace',
  })
  expect(result.details).toEqual({ memory })
})

test('registers save_memory as a Pi product tool', () => {
  const registry = new ToolRegistry()
  const repo = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as AgentMemoryRepo

  registerPiMemoryTool(registry, repo, 'C:/workspace')

  expect(registry.get('save_memory')).toMatchObject({ name: 'save_memory', label: 'Save memory' })
})
