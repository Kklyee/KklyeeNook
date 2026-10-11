// @vitest-environment jsdom

import { act } from 'react'
import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'

import { ModelSelectorContent, ModelSelectorRoot } from './model-selector'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
HTMLElement.prototype.scrollIntoView = () => undefined

afterEach(() => {
  document.body.innerHTML = ''
})

test('changes the controlled reasoning effort when a radio is clicked', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  function Harness() {
    const [effort, setEffort] = useState('off')
    return createElement(ModelSelectorRoot, {
      models: [
        {
          id: 'reasoning-model',
          name: 'Reasoning model',
          efforts: [
            { id: 'off', name: '关闭' },
            { id: 'medium', name: '中' },
          ],
        },
      ],
      value: 'reasoning-model',
      effort,
      onEffortChange: setEffort,
      defaultOpen: true,
      children: createElement(ModelSelectorContent),
    })
  }

  await act(() => root.render(createElement(Harness)))
  const medium = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (radio) => radio.textContent === '中',
  )
  expect(medium).not.toBeNull()

  await act(() => medium!.click())

  expect(medium?.hasAttribute('data-checked')).toBe(true)
  await act(() => root.unmount())
})

test('filters models by provider without closing the panel', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(() =>
    root.render(
      createElement(ModelSelectorRoot, {
        models: [
          { id: 'model-a', name: 'Model A', description: 'Provider A' },
          { id: 'model-b', name: 'Model B', description: 'Provider B' },
          { id: 'model-c', name: 'Model C', description: 'Provider C' },
        ],
        defaultOpen: true,
        children: createElement(ModelSelectorContent),
      }),
    ),
  )

  expect(document.querySelectorAll('[data-slot="model-selector-item"]')).toHaveLength(1)
  expect(document.querySelector('[data-slot="model-selector-item"]')?.textContent).toContain(
    'Model A',
  )
  const provider = document.querySelector<HTMLElement>('button[aria-label="Provider B"]')
  await act(() => provider!.click())
  const model = document.querySelector<HTMLElement>('[data-slot="model-selector-item"]')
  expect(model?.textContent).toContain('Model B')
  await act(() => model!.click())
  expect(document.querySelector('[data-slot="model-selector-content"]')).not.toBeNull()

  await act(() => root.unmount())
})

test('updates thinking options only after selecting a model from another provider', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  function Harness() {
    const [value, setValue] = useState('a')
    return createElement(ModelSelectorRoot, {
      models: [
        {
          id: 'a',
          name: 'Model A',
          provider: 'deepseek',
          providerName: 'DeepSeek',
          efforts: [{ id: 'medium', name: 'Medium' }],
        },
        {
          id: 'b',
          name: 'Model B',
          provider: 'zai',
          providerName: 'Z.AI',
          efforts: [{ id: 'high', name: 'High' }],
        },
      ],
      value,
      onValueChange: setValue,
      defaultOpen: true,
      children: createElement(ModelSelectorContent),
    })
  }
  await act(() => root.render(createElement(Harness)))
  await act(() => document.querySelector<HTMLElement>('button[aria-label="Z.AI"]')!.click())
  expect(document.querySelector('[role="radio"]')?.textContent).toBe('Medium')
  await act(() => document.querySelector<HTMLElement>('[data-slot="model-selector-item"]')!.click())
  expect(document.querySelector('[role="radio"]')?.textContent).toBe('High')
  expect(document.querySelector('[data-slot="model-selector-content"]')).not.toBeNull()
  await act(() => root.unmount())
})
