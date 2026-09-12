import { expect, test } from 'vitest'

import { resolveModelInput } from './modelCapabilities'

test('treats current DeepSeek V4.1 Flash aliases as image-capable', () => {
  expect(resolveModelInput('deepseek', 'deepseek-v4-flash', ['text'])).toEqual([
    'text',
    'image',
  ])
  expect(resolveModelInput('deepseek', 'deepseek-flash', ['text'])).toEqual(['text', 'image'])
})

test('preserves the declared inputs for unrelated models', () => {
  expect(resolveModelInput('openai', 'text-only', ['text'])).toEqual(['text'])
  expect(resolveModelInput('deepseek', 'deepseek-v4-flash-vision-exp', ['text', 'image'])).toEqual([
    'text',
    'image',
  ])
})
