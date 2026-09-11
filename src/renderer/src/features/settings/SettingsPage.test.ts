import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { SettingsPage } from './SettingsPage'

const settings: AgentSettingsSnapshot = {
  provider: 'test',
  modelID: 'test-model',
  thinkingLevel: 'off',
  cwd: '/project',
  hasApiKey: true,
  activeModelId: 'test:test-model',
  models: [
    {
      id: 'test:test-model',
      provider: 'test',
      providerName: 'Test',
      modelID: 'test-model',
      modelName: 'Test Model',
      thinkingLevel: 'off',
      hasApiKey: true,
    },
  ],
  catalog: [
    {
      id: 'test',
      name: 'Test',
      models: [
        {
          id: 'test-model',
          name: 'Test Model',
          reasoning: false,
          contextWindow: 8_000,
          maxTokens: 1_000,
        },
      ],
    },
  ],
  credentialPersistenceAvailable: true,
  tools: [{ name: 'read', requiresApproval: true }],
  permissionGrants: [],
}

test('renders settings as a dedicated page with navigation back to the app', () => {
  const markup = renderToStaticMarkup(
    createElement(SettingsPage, { settings, error: null, onClose() {}, async onChanged() {} }),
  )

  expect(markup).toContain('返回应用')
  expect(markup).toContain('搜索设置')
  expect(markup).toContain('aria-current="page"')
  expect(markup).toContain('模型与工作目录')
  expect(markup).toContain('已保存的模型')
  expect(markup).toContain('模型服务商')
  expect(markup).toContain('Test Model')
})

test('renders the permissions tab with a settings snapshot from before grants were added', () => {
  const legacySettings = {
    provider: 'test',
    modelID: 'test-model',
    thinkingLevel: 'off',
    cwd: '/project',
    hasApiKey: true,
    tools: [{ name: 'read', requiresApproval: true }],
  } as unknown as AgentSettingsSnapshot

  let markup = ''
  expect(() => {
    markup = renderToStaticMarkup(
      createElement(SettingsPage, {
        settings: legacySettings,
        error: null,
        initialTab: 'permissions',
        onClose() {},
        async onChanged() {},
      }),
    )
  }).not.toThrow()
  expect(markup).toContain('1 个受保护工具')
  expect(markup).toContain('未授权时询问')
  expect(markup).toContain('尚无已保存的权限')
})
