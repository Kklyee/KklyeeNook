import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { ToolTimeline } from '@kklyeenook/ui/assistant-ui/tool-timeline'

test('the timeline chevron sits after the label and rotates only while the panel is open', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const render = (open: boolean) =>
    root.render(
      createElement(ToolTimeline, {
        open,
        onOpenChange: () => {},
        label: createElement('span', null, '运行了 1 个命令'),
        trailing: createElement('span', null, '2.0s'),
        children: createElement('div', null, 'bash'),
      }),
    )
  try {
    await act(() => render(false))
    const trigger = element.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!
    const chevron = trigger.querySelector('svg')!
    const children = [...trigger.children]
    expect(trigger.getAttribute('data-panel-open')).toBeNull()
    expect(chevron.classList.contains('group-data-panel-open/trigger:rotate-90')).toBe(true)
    expect(children[0]?.lastElementChild).toBe(chevron)
    expect(chevron.previousElementSibling?.textContent).toBe('运行了 1 个命令')
    expect(children.at(-1)?.textContent).toBe('2.0s')

    await act(() => render(true))
    expect(trigger.getAttribute('data-panel-open')).toBe('')
  } finally {
    await act(() => root.unmount())
    element.remove()
  }
})
