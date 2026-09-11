import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

import type { PermissionGrant } from '@/shared/approval/approvalTypes'
import { connectDatabase } from '../client'
import { conversations } from '../schema/conversations'
import { DrizzlePermissionGrantRepo } from './permissionGrantRepo'

const permission = {
  toolName: 'read',
  action: 'filesystem.read',
  resourceKind: 'path' as const,
  resource: '/project',
  recursive: true,
  description: '读取项目目录 /project',
}

test('persists grants and removes session grants with their Agent Session', async () => {
  const migrationsFolder = fileURLToPath(new URL('../../../../drizzle', import.meta.url))
  const { database, close } = await connectDatabase('file::memory:', migrationsFolder)

  try {
    await database
      .insert(conversations)
      .values({ id: 'session-1', title: 'Test', createdAt: 1, updatedAt: 1 })
    const repo = new DrizzlePermissionGrantRepo(database)
    const sessionGrant: PermissionGrant = {
      id: 'session-grant',
      effect: 'allow',
      duration: 'session',
      sessionId: 'session-1',
      permission,
      createdAt: 1,
    }
    const alwaysGrant: PermissionGrant = {
      ...sessionGrant,
      id: 'always-grant',
      duration: 'always',
      sessionId: undefined,
      createdAt: 2,
    }

    await repo.save(sessionGrant)
    await repo.save(alwaysGrant)
    await expect(repo.list()).resolves.toEqual([sessionGrant, alwaysGrant])

    await database.delete(conversations)
    await expect(repo.list()).resolves.toEqual([alwaysGrant])
  } finally {
    close()
  }
})
