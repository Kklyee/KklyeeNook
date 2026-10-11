import { expect, test } from 'vitest'
import type { NetworkBotIdentity, SocialGrant } from '@kklyeenook/shared/bot/social'
import { SocialAuthorization, type SocialRequest } from '@kklyeenook/shared/bot/authorization'

const authorization = new SocialAuthorization()
const target: NetworkBotIdentity = {
  networkId: 'bob:designer',
  localBotId: 'designer',
  ownerUserId: 'bob',
  hostId: 'bob-host',
  name: 'Designer',
}
const grant: SocialGrant = {
  id: 'grant-1',
  issuerUserId: 'bob',
  subject: { type: 'bot', id: 'alice:coder' },
  targetBotId: target.networkId,
  actions: ['message.send', 'task.request'],
}
const request: SocialRequest = {
  subject: grant.subject,
  subjectOwnerUserId: 'alice',
  target,
  action: 'task.request',
}

test('defaults to denial and matches a verified Bot principal exactly', () => {
  expect(authorization.evaluate(request, [], {}, 100)).toMatchObject({ allowed: false })
  expect(authorization.evaluate(request, [grant], {}, 100)).toEqual({
    allowed: true,
    grantId: grant.id,
  })
  expect(
    authorization.evaluate(
      { ...request, subject: { type: 'bot', id: 'other:coder' } },
      [grant],
      {},
      100,
    ),
  ).toMatchObject({ allowed: false })
  expect(
    authorization.evaluate(
      { ...request, target: { ...target, networkId: 'other:designer' } },
      [grant],
      {},
      100,
    ),
  ).toMatchObject({ allowed: false })
})

test('a User grant never expands to any of that user’s Bots or a same-ID Bot principal', () => {
  const userGrant = { ...grant, subject: { type: 'user' as const, id: 'alice' } }
  expect(authorization.evaluate(request, [userGrant], {}, 100)).toMatchObject({ allowed: false })
  expect(
    authorization.evaluate(
      { ...request, subject: { type: 'bot', id: 'alice' } },
      [userGrant],
      {},
      100,
    ),
  ).toMatchObject({ allowed: false })
  expect(
    authorization.evaluate({ ...request, subject: userGrant.subject }, [userGrant], {}, 100),
  ).toMatchObject({ allowed: true })
})

test('same-owner communication grants no installation or tool invocation permissions', () => {
  const local = { ...request, subjectOwnerUserId: 'bob' }
  expect(authorization.evaluate(local, [], {}, 100)).toEqual({ allowed: true })
  for (const action of ['tool.propose', 'tool.install', 'tool.invoke'] as const)
    expect(authorization.evaluate({ ...local, action }, [], {}, 100)).toMatchObject({
      allowed: false,
    })
})

test('rejects expired, revoked, exhausted and incorrectly issued grants', () => {
  for (const invalid of [
    { ...grant, revokedAt: 0 },
    { ...grant, constraints: { expiresAt: 100 } },
    { ...grant, issuerUserId: 'alice' },
    { ...grant, actions: ['message.send'] as const },
  ])
    expect(authorization.evaluate(request, [invalid as SocialGrant], {}, 100)).toMatchObject({
      allowed: false,
    })
  const limited = { ...grant, constraints: { maxUses: 1 } }
  expect(authorization.evaluate(request, [limited], { [grant.id]: 1 }, 100)).toMatchObject({
    allowed: false,
  })
  expect(authorization.evaluate(request, [limited], {}, 100)).toMatchObject({ allowed: true })
})

test('installation and invocation are separate and capability allowlists fail closed', () => {
  const install: SocialGrant = {
    ...grant,
    actions: ['tool.install'],
    constraints: { allowedMcpServers: ['design-mcp'] },
  }
  expect(
    authorization.evaluate(
      { ...request, action: 'tool.install', mcpServerId: 'design-mcp' },
      [install],
      {},
      100,
    ),
  ).toMatchObject({ allowed: true })
  expect(
    authorization.evaluate(
      { ...request, action: 'tool.invoke', mcpServerId: 'design-mcp' },
      [install],
      {},
      100,
    ),
  ).toMatchObject({ allowed: false })
  for (const mcpServerId of [undefined, 'other-mcp'])
    expect(
      authorization.evaluate(
        { ...request, action: 'tool.install', mcpServerId },
        [install],
        {},
        100,
      ),
    ).toMatchObject({ allowed: false })
  const invoke: SocialGrant = {
    ...grant,
    actions: ['tool.invoke'],
    constraints: { allowedToolIds: ['review'] },
  }
  expect(
    authorization.evaluate(
      { ...request, action: 'tool.invoke', toolId: 'review' },
      [invoke],
      {},
      100,
    ),
  ).toMatchObject({ allowed: true })
  expect(
    authorization.evaluate({ ...request, action: 'tool.invoke' }, [invoke], {}, 100),
  ).toMatchObject({ allowed: false })
})

test('only a target owner User principal can issue a grant; Bot models cannot delegate grants', () => {
  expect(() =>
    authorization.validateGrant({ type: 'user', id: 'bob' }, target, grant),
  ).not.toThrow()
  for (const issuer of [
    { type: 'user' as const, id: 'alice' },
    { type: 'bot' as const, id: 'bob' },
  ])
    expect(() => authorization.validateGrant(issuer, target, grant)).toThrow(
      'Only the target Bot owner',
    )
  expect(() =>
    authorization.validateGrant({ type: 'user', id: 'bob' }, target, {
      ...grant,
      constraints: { maxUses: 0 },
    }),
  ).toThrow('maxUses')
})
