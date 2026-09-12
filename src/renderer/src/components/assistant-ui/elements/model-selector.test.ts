// @vitest-environment jsdom

import { act } from 'react'
import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'

import {
  ModelSelectorContent,
  ModelSelectorRoot,
} from './model-selector'

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
    return createElement(
      ModelSelectorRoot,
      {
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
      },
    )
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
