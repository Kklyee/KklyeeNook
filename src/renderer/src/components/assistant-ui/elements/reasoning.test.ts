import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { ReasoningRoot, ReasoningTrigger } from './reasoning'

test('renders a compact Thinking disclosure with only the expand icon', () => {
  const markup = renderToStaticMarkup(
    createElement(ReasoningRoot, null, createElement(ReasoningTrigger)),
  )

  expect(markup).toContain('Thinking')
  expect(markup).toContain('reasoning-trigger-chevron')
  expect(markup).not.toContain('reasoning-trigger-icon')
  expect(markup).not.toContain('rounded-lg border px-3 py-2')
})
