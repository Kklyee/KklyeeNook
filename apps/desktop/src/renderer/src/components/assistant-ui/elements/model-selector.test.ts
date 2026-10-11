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
  const effortSection = document.querySelector<HTMLElement>(
    '[data-section="effort"] [data-slot="model-selector-section-trigger"]',
  )
  expect(effortSection).not.toBeNull()

  await act(() => effortSection!.click())

  const medium = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (radio) => radio.textContent === '中',
  )
  expect(medium).not.toBeNull()

  await act(() => medium!.click())

  expect(medium?.hasAttribute('data-checked')).toBe(true)
  await act(() => root.unmount())
})

test('keeps model entries separated with compact provider text', async () => {
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

  const modelSection = document.querySelector<HTMLElement>(
    '[data-section="model"] [data-slot="model-selector-section-trigger"]',
  )
  expect(modelSection).not.toBeNull()

  await act(() => modelSection!.click())

  const modelGroup = document.querySelector<HTMLElement>('[data-slot="command-group"]')
  const provider = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="model-selector-item"] span span'),
  ].find((element) => element.textContent === 'Provider A')
  expect(modelGroup?.className).toContain('gap-1')
  expect(provider?.className).toContain('text-[10px]')

  await act(() => root.unmount())
})
