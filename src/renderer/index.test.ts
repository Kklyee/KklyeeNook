import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('allows local blob URLs used by composer image previews', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

  expect(html).toContain("img-src 'self' data: blob:")
})

test('allows the loopback agent backend in the renderer connect policy', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

  expect(html).toContain("connect-src 'self' http://127.0.0.1:*")
})
