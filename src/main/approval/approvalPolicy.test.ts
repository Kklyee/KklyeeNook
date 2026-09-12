import { expect, test } from 'vitest'

import type { PermissionGrant } from '@/shared/approval/approvalTypes'
import type { PermissionGrantRepo } from '../db/repositories/permissionGrantRepo'
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

test('a session grant allows every call to the same built-in tool only in that Agent Session', async () => {
  const repo = new MemoryPermissionGrantRepo()
  const policy = new ApprovalPolicy(repo)
  const firstRead = await policy.evaluate('session-1', 'read', { path: 'src/index.ts' })

  expect(firstRead.outcome).toBe('prompt')
  if (firstRead.outcome !== 'prompt') throw new Error('Expected a prompt')

  await policy.grant('session', 'session-1', firstRead.permission)

  await expect(
    policy.evaluate('session-1', 'read', { path: '../outside.txt' }),
  ).resolves.toMatchObject({ outcome: 'allow' })
  await expect(policy.evaluate('session-2', 'read', { path: 'README.md' })).resolves.toEqual({
    outcome: 'prompt',
    permission: expect.any(Object),
  })
  await expect(policy.evaluate('session-1', 'bash', { command: 'npm test' })).resolves.toEqual({
    outcome: 'prompt',
    permission: expect.any(Object),
  })
})

test('a read grant does not allow a bash deletion', async () => {
  const repo = new MemoryPermissionGrantRepo()
  const policy = new ApprovalPolicy(repo)
  const read = await policy.evaluate('session-1', 'read', { path: 'package.json' })
  if (read.outcome !== 'prompt') throw new Error('Expected a prompt')
  await policy.grant('session', 'session-1', read.permission)

  const deletion = await policy.evaluate('session-1', 'bash', { command: 'rm -rf dist' })

  expect(deletion).toMatchObject({
    outcome: 'prompt',
    permission: {
      toolName: 'bash',
      action: 'tool.execute',
      resourceKind: 'tool',
      resource: 'bash',
    },
  })
})

test('a bash grant allows later commands without matching their text', async () => {
  const repo = new MemoryPermissionGrantRepo()
  const policy = new ApprovalPolicy(repo)
  const request = await policy.evaluate('session-1', 'bash', { command: 'npm test' })
  if (request.outcome !== 'prompt') throw new Error('Expected a prompt')

  await policy.grant('session', 'session-1', request.permission)

  await expect(
    policy.evaluate('session-1', 'bash', { command: 'git status' }),
  ).resolves.toMatchObject({ outcome: 'allow' })
})

test('an always grant is loaded by a new policy instance and can be revoked', async () => {
  const repo = new MemoryPermissionGrantRepo()
  const policy = new ApprovalPolicy(repo)
  const request = await policy.evaluate('session-1', 'bash', { command: 'npm test' })
  if (request.outcome !== 'prompt') throw new Error('Expected a prompt')
  const grant = await policy.grant('always', 'session-1', request.permission)

  const restartedPolicy = new ApprovalPolicy(repo)
  await expect(
    restartedPolicy.evaluate('different-session', 'bash', { command: 'git status' }),
  ).resolves.toMatchObject({ outcome: 'allow', grant: { id: grant.id } })

  await restartedPolicy.revoke(grant.id)
  await expect(
    restartedPolicy.evaluate('different-session', 'bash', { command: 'npm test' }),
  ).resolves.toMatchObject({ outcome: 'prompt' })
})

test('legacy command grants are exposed once per tool and revoked together', async () => {
  const repo = new MemoryPermissionGrantRepo()
  repo.grants = [
    {
      id: 'first-command',
      effect: 'allow',
      duration: 'always',
      permission: {
        toolName: 'bash',
        action: 'shell.execute',
        resourceKind: 'command',
        resource: 'npm test',
        recursive: false,
        description: '执行命令 npm test',
      },
      createdAt: 1,
    },
    {
      id: 'second-command',
      effect: 'allow',
      duration: 'always',
      permission: {
        toolName: 'bash',
        action: 'shell.execute',
        resourceKind: 'command',
        resource: 'git status',
        recursive: false,
        description: '执行命令 git status',
      },
      createdAt: 2,
    },
  ]
  const policy = new ApprovalPolicy(repo)

  await expect(policy.listGrants()).resolves.toEqual([
    expect.objectContaining({
      id: 'first-command',
      permission: expect.objectContaining({
        toolName: 'bash',
        action: 'tool.execute',
        resourceKind: 'tool',
        resource: 'bash',
      }),
    }),
  ])

  await policy.revoke('first-command')
  expect(repo.grants).toEqual([])
})

test('tools outside the protected set run without a grant', async () => {
  const policy = new ApprovalPolicy(new MemoryPermissionGrantRepo())

  await expect(policy.evaluate('session-1', 'search', {})).resolves.toEqual({ outcome: 'allow' })
})
