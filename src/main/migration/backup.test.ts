import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'

import { createBackup, createMigrationProof, restoreBackup, verifyBackup } from './backup'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('backs up JSONL, tool data, and committed SQLite WAL content, then restores to a fresh rehearsal directory', async () => {
  const base = await tempRoot()
  const source = join(base, 'source')
  const backup = join(base, 'backup')
  const restore = join(base, 'restore')
  await mkdir(join(source, 'pi-sessions'), { recursive: true })
  await mkdir(join(source, 'tool-results'), { recursive: true })
  await writeFile(join(source, 'pi-sessions', 'old.jsonl'), '{"type":"session","id":"legacy-a"}\n')
  await writeFile(join(source, 'tool-results', 'result.json'), '{"ok":true}')
  await createSqlite(join(source, 'data', 'app.sqlite'))

  const manifest = await createBackup({ sourceDir: source, backupDir: backup, stopped: true, proof: createMigrationProof(source) })
  const restored = await restoreBackup({ backupDir: backup, rehearsalDir: restore, proof: createMigrationProof(restore) })

  expect(manifest.entries.map((entry) => entry.path).sort()).toEqual([rel('data', 'app.sqlite'), rel('pi-sessions', 'old.jsonl'), rel('tool-results', 'result.json')])
  expect(restored.entries).toEqual(manifest.entries)
  expect(await readFile(join(restore, 'pi-sessions', 'old.jsonl'), 'utf8')).toContain('legacy-a')
  expect(queryRestored(join(restore, 'data', 'app.sqlite'))).toEqual([{ id: 1, name: 'wal-row' }])
}, 30_000)

test('requires stopped-source confirmation and matching ownership proof', async () => {
  const base = await tempRoot()
  const source = join(base, 'source')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'file.txt'), 'data')

  await expect(createBackup({ sourceDir: source, backupDir: join(base, 'backup-a'), stopped: false, proof: createMigrationProof(source) })).rejects.toThrow('stopped-app')
  await expect(createBackup({ sourceDir: source, backupDir: join(base, 'backup-b'), stopped: true, proof: createMigrationProof(join(base, 'other')) })).rejects.toThrow('Ownership proof')
})

test('rejects tampered files, malformed manifests, traversal entries, and non-fresh restore targets', async () => {
  const base = await tempRoot()
  const source = join(base, 'source')
  const backup = join(base, 'backup')
  const restore = join(base, 'restore')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'file.txt'), 'data')
  await createBackup({ sourceDir: source, backupDir: backup, stopped: true, proof: createMigrationProof(source) })

  await writeFile(join(backup, 'file.txt'), 'tampered')
  await expect(verifyBackup(backup)).rejects.toThrow('hash mismatch')
  await writeFile(join(backup, 'file.txt'), 'data')
  await mkdir(restore, { recursive: true })
  await writeFile(join(restore, 'existing.txt'), 'occupied')
  await expect(restoreBackup({ backupDir: backup, rehearsalDir: restore, proof: createMigrationProof(restore) })).rejects.toThrow('fresh')
  await writeFile(join(backup, 'manifest.json'), '{bad')
  await expect(verifyBackup(backup)).rejects.toThrow('manifest')
  await writeFile(join(backup, 'manifest.json'), JSON.stringify({ version: 1, sourceRoot: source, entries: [{ path: '../escape.txt', originalPath: '../escape.txt', size: 1, sha256: 'x', sqlite: false }] }))
  await expect(verifyBackup(backup)).rejects.toThrow('Unsafe relative path')
})

test('rejects symlink boundaries during backup and verification', async () => {
  const base = await tempRoot()
  const source = join(base, 'source')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'real.txt'), 'data')
  try {
    await symlink(join(source, 'real.txt'), join(source, 'link.txt'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return
    throw error
  }

  await expect(createBackup({ sourceDir: source, backupDir: join(base, 'backup'), stopped: true, proof: createMigrationProof(source) })).rejects.toThrow('Symlink')
})

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'nook-backup-test-'))
  roots.push(root)
  return root
}

async function createSqlite(path: string) {
  await mkdir(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    db.exec("INSERT INTO items(name) VALUES ('wal-row')")
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

function queryRestored(path: string) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT id, name FROM items ORDER BY id').all()
  } finally {
    db.close()
  }
}

function rel(...parts: string[]) {
  return parts.join(process.platform === 'win32' ? '\\' : '/')
}
