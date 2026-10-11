import { expect, test } from 'vitest'

import { ToolRegistry } from '@/main/tools/toolRegistry'
import { registerPlanTool } from './plan-tool'

test('registers update_plan as a Pi backed product tool', () => {
  const registry = new ToolRegistry()
  registerPlanTool(registry)

  expect(registry.get('update_plan')).toMatchObject({
    name: 'update_plan',
    label: 'Update plan',
  })
  expect(
    registry.resolve<{ name: string }>(['update_plan'], { cwd: process.cwd() }),
  ).toMatchObject([{ name: 'update_plan' }])
})
