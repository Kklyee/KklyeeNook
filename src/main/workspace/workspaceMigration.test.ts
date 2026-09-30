import { migrate } from 'drizzle-orm/libsql/migrator'
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { connectDatabase } from '../db/client'
import { DrizzleWorkspaceRepo } from '../db/repositories/workspaceRepo'
import { DrizzleAgentMemoryRepo } from '../db/repositories/memoryRepo'
import { DrizzleAgentSessionRepo } from '../db/repositories/agentSessionRepo'
import { KnowledgeRepo } from '../db/repositories/knowledgeRepo'

test('upgrades legacy path scopes without losing histories or turning workspace knowledge global', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nook-migration-'))
  const original = fileURLToPath(new URL('../../../drizzle', import.meta.url))
  const oldMigrations = join(directory, 'migrations')
  await mkdir(oldMigrations)
  for (const entry of await readdir(original))
    if (entry < '20260930093556')
      await cp(join(original, entry), join(oldMigrations, entry), { recursive: true })
  const url = 'file::memory:'
  let close = () => {}
  try {
    const old = await connectDatabase(url, oldMigrations)
    close = old.close
    await old.database.$client.execute(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('old-chat', 'History', 1, 1)",
    )
    await old.database.$client.execute(
      "INSERT INTO memories (id, scope, workspace_path, content, created_at, updated_at) VALUES ('memory', 'workspace', 'C:/legacy', 'project fact', 1, 1), ('global', 'global', NULL, 'global fact', 1, 1)",
    )
    await old.database.$client.execute(
      "INSERT INTO knowledge_sources (id, name, path, kind, status) VALUES ('knowledge', 'Legacy', 'C:/legacy', 'workspace', 'ready')",
    )
    await migrate(old.database, { migrationsFolder: original })
    const updated = old
    const workspaces = await new DrizzleWorkspaceRepo(updated.database).list()
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]).toMatchObject({ status: 'detached', lastKnownPath: 'C:/legacy' })
    const memories = new DrizzleAgentMemoryRepo(updated.database)
    expect((await memories.list()).map((item) => item.id)).toEqual(['global'])
    expect((await memories.list(workspaces[0].id)).map((item) => item.id)).toContain('memory')
    expect((await new KnowledgeRepo(updated.database).listSources())[0].workspaceId).toBe(
      workspaces[0].id,
    )
    expect(await new DrizzleAgentSessionRepo(updated.database).findById('old-chat')).toMatchObject({
      title: 'History',
      workspaceId: null,
    })
  } finally {
    close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
