// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPendingNewThreadPreferences } from './runtime/pendingNewThreadPreferences'

const mocks = vi.hoisted(() => ({
  runtime: {
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
  },
  auiState: {
    threadListItem: { id: '__new__', remoteId: undefined },
  },
}))

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (state: typeof mocks.auiState) => unknown) => selector(mocks.auiState),
}))

vi.mock('@assistant-ui/react-pi', () => ({
  usePiRuntimeExtras: () => mocks.runtime,
  usePiSession: () => null,
}))

vi.mock('../../components/assistant-ui/elements/thread.aui', () => ({
  Thread: ({
    modelSelector,
  }: {
    modelSelector: {
      effort?: string
      onEffortChange: (level: string) => void
    }
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'thinking-effort',
        onClick: () => modelSelector.onEffortChange('high'),
      },
      modelSelector.effort,
    ),
}))

vi.mock('../runs/RunHistoryPanel', () => ({
  RunHistoryPanel: () => null,
}))

vi.mock('./runtime/PiExtensionUiPrompt', () => ({
  PiExtensionUiPrompt: () => null,
}))

import { ChatPanel } from './ChatPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const settings: AgentSettingsSnapshot = {
  provider: 'deepseek',
  modelID: 'deepseek-v4-flash',
  providerName: 'DeepSeek',
  thinkingLevel: 'off',
  cwd: 'D:/repo',
  hasApiKey: true,
  models: [
    {
      id: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      providerName: 'DeepSeek',
      modelID: 'deepseek-v4-flash',
      modelName: 'DeepSeek V4 Flash',
      thinkingLevel: 'off',
      hasApiKey: true,
    },
  ],
  activeModelId: 'deepseek:deepseek-v4-flash',
  catalog: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          reasoning: true,
          input: ['text', 'image'],
          availableThinkingLevels: ['off', 'low', 'high'],
          contextWindow: 128_000,
          maxTokens: 8_192,
        },
      ],
    },
  ],
  credentialPersistenceAvailable: true,
  tools: [],
  permissionGrants: [],
}

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  clearPendingNewThreadPreferences()
  vi.clearAllMocks()
})

describe('ChatPanel new thread controls', () => {
  it('keeps a thinking-level selection before the first message creates a thread', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(() => root!.render(createElement(ChatPanel, { settings })))
    const effortButton = container.querySelector('[data-testid="thinking-effort"]')
    expect(effortButton?.textContent).toBe('off')

    await act(() => effortButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(effortButton?.textContent).toBe('high')
    expect(mocks.runtime.setThinkingLevel).not.toHaveBeenCalled()
  })
})
