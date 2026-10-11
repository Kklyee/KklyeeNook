import { expect, test } from 'vitest'
import { RemoteTransport } from './remote-transport'

test('Relay credentials require HTTPS except loopback and are never permitted in URL components', () => {
  for (const url of [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com?token=secret',
    'https://example.com#secret',
  ])
    expect(() => new RemoteTransport(url, () => 'token')).toThrow()
  for (const url of ['https://example.com', 'http://127.0.0.1:43128', 'http://localhost:43128'])
    expect(() => new RemoteTransport(url, () => 'token')).not.toThrow()
})

test('missing Host credentials fail before sending requests', async () => {
  const transport = new RemoteTransport('http://127.0.0.1:1', () => undefined)
  await expect(transport.inbox()).rejects.toThrow('credential is not configured')
})
