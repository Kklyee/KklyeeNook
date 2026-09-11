import { join } from 'node:path'
import { expect, test } from 'vitest'

import type { PermissionGrant } from '@/shared/approval/approvalTypes'
import type { PermissionGrantRepo } from '../db/repo/permissionGrantRepo'
import { ApprovalPolicy } from './approvalPolicy'

class MemoryPermissionGrantRepo implements PermissionGrantRepo {
  grants: PermissionGrant[] = []

  async list() {
    return [...this.grants]
  }

  async save(grant: PermissionGrant) {
    this.grants.push(grant)
  }

  async delete(id: string) {
    this.grants = this.grants.filter((grant) => grant.id !== id)
  }
}

test('a session read grant allows project reads only in that Agent Session', async () => {
  const repo = new MemoryPermissionGrantRepo()
  const cwd = join(process.cwd(), 'project')
  const policy = new ApprovalPolicy(repo, cwd)
  const firstRead = await policy.evaluate('session-1', 'read', { path: 'src/index.ts' })

  expect(firstRead.outcome).toBe('prompt')
  if (firstRead.outcome !== 'prompt') throw new Error('Expected a prompt')

  await policy.grant('session', 'session-1', firstRead.permission)

  await expect(policy.evaluate('session-1', 'read', { path: 'README.md' })).resolves.toMatchObject({
    outcome: 'allow',
  })
  await expect(policy.evaluate('session-2', 'read', { path: 'README.md' })).resolves.toEqual({
    outcome: 'prompt',
    permission: expect.any(Object),
  })
  await expect(
    policy.evaluate('session-1', 'read', { path: join(cwd, '..', 'outside.txt') }),
  ).resolves.toEqual({ outcome: 'prompt', permission: expect.any(Object) })
})

test('a read grant does not allow a bash deletion', async () => {
  const repo = new MemoryPermissionGrantRepo()
  const policy = new ApprovalPolicy(repo, join(process.cwd(), 'project'))
  const read = await policy.evaluate('session-1', 'read', { path: 'package.json' })
  if (read.outcome !== 'prompt') throw new Error('Expected a prompt')
  await policy.grant('session', 'session-1', read.permission)

  const deletion = await policy.evaluate('session-1', 'bash', { command: 'rm -rf dist' })

  expect(deletion).toMatchObject({
    outcome: 'prompt',
    permission: { toolName: 'bash', action: 'shell.delete' },
  })
})

test('an always grant is loaded by a new policy instance and can be revoked', async () => {
  const repo = new MemoryPermissionGrantRepo()
  const cwd = join(process.cwd(), 'project')
  const policy = new ApprovalPolicy(repo, cwd)
  const request = await policy.evaluate('session-1', 'bash', { command: 'npm test' })
  if (request.outcome !== 'prompt') throw new Error('Expected a prompt')
  const grant = await policy.grant('always', 'session-1', request.permission)

  const restartedPolicy = new ApprovalPolicy(repo, cwd)
  await expect(
    restartedPolicy.evaluate('different-session', 'bash', { command: 'npm test' }),
  ).resolves.toMatchObject({ outcome: 'allow', grant: { id: grant.id } })

  await restartedPolicy.revoke(grant.id)
  await expect(
    restartedPolicy.evaluate('different-session', 'bash', { command: 'npm test' }),
  ).resolves.toMatchObject({ outcome: 'prompt' })
})

test('tools outside the protected set run without a grant', async () => {
  const policy = new ApprovalPolicy(new MemoryPermissionGrantRepo(), process.cwd())

  await expect(policy.evaluate('session-1', 'search', {})).resolves.toEqual({ outcome: 'allow' })
})
