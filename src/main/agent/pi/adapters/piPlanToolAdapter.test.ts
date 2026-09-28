import { expect, test } from 'vitest'

import { ToolRegistry } from '@/main/tools/toolRegistry'
import { registerPiPlanTool } from './piPlanToolAdapter'

test('registers update_plan as a Pi backed product tool', () => {
  const registry = new ToolRegistry()
  registerPiPlanTool(registry)

  expect(registry.get('update_plan')).toMatchObject({
    name: 'update_plan',
    label: 'Update plan',
  })
  expect(
    registry.resolve<{ name: string }>('pi', ['update_plan'], { cwd: process.cwd() }),
  ).toMatchObject([{ name: 'update_plan' }])
})
