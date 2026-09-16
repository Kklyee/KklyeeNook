import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('allows local blob URLs used by composer image previews', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

  expect(html).toContain("img-src 'self' data: blob:")
})

test('allows the loopback agent backend in the renderer connect policy', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const contentPolicy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]
  const connectSource = contentPolicy
    ?.split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('connect-src '))

  expect(connectSource).toBe("connect-src 'self' http://127.0.0.1:*")
})
