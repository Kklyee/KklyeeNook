import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite'

export type MigrationProof = {
  root: string
  owner: string
  token: string
}

export type BackupManifestEntry = {
  path: string
  originalPath: string
  size: number
  sha256: string
  sqlite: boolean
}

export type BackupManifest = {
  version: 1
  sourceRoot: string
  createdAt: string
  entries: BackupManifestEntry[]
}

export type CreateBackupOptions = {
  sourceDir: string
  backupDir: string
  stopped: boolean
  proof: MigrationProof
}

export type RestoreBackupOptions = {
  backupDir: string
  rehearsalDir: string
  proof: MigrationProof
}

const manifestName = 'manifest.json'

export function createMigrationProof(root: string): MigrationProof {
  const resolved = resolve(root)
  const owner = `${process.env.USERDOMAIN ?? ''}/${process.env.USERNAME ?? process.env.USER ?? ''}@${hostname()}`
  return {
    root: resolved,
    owner,
    token: createHash('sha256').update(`${resolved}\0${owner}`).digest('hex'),
  }
}

export async function createBackup(options: CreateBackupOptions): Promise<BackupManifest> {
  const source = resolve(options.sourceDir)
  const backup = resolve(options.backupDir)
  if (!options.stopped) throw new Error('Backup requires stopped-app confirmation')
  assertProof(options.proof, source)
  await assertRealDirectory(source, 'Backup source')
  await assertFreshDirectory(backup, 'Backup target')
  if (isInside(source, backup) || isInside(backup, source)) throw new Error('Backup target must be separate from source')
  const before = await snapshot(source)
  await mkdir(backup, { recursive: true })
  const entries: BackupManifestEntry[] = []
  for (const file of before.files) {
    const target = join(backup, file.relativePath)
    await mkdir(dirname(target), { recursive: true })
    if (file.sqlite) {
      await copySqlite(file.path, target)
      await assertSqliteIntegrity(target)
    } else {
      await copyFile(file.path, target)
    }
    const hash = await sha256File(target)
    const copied = await stat(target)
    entries.push({
      path: file.relativePath,
      originalPath: file.relativePath,
      size: copied.size,
      sha256: hash,
      sqlite: file.sqlite,
    })
  }
  const after = await snapshot(source)
  assertUnchanged(before, after)
  const manifest: BackupManifest = {
    version: 1,
    sourceRoot: source,
    createdAt: new Date().toISOString(),
    entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
  }
  await writeFile(join(backup, manifestName), JSON.stringify(manifest, null, 2), 'utf8')
  return manifest
}

export async function verifyBackup(backupDir: string): Promise<BackupManifest> {
  const backup = resolve(backupDir)
  await assertRealDirectory(backup, 'Backup directory')
  const manifest = parseManifest(await readFile(join(backup, manifestName), 'utf8'))
  for (const entry of manifest.entries) {
    assertRelativePath(entry.path)
    const file = join(backup, entry.path)
    assertInside(backup, file)
    const item = await lstat(file).catch(() => undefined)
    if (!item?.isFile() || item.isSymbolicLink()) throw new Error(`Backup file missing: ${entry.path}`)
    const actual = await sha256File(file)
    if (actual !== entry.sha256) throw new Error(`Backup file hash mismatch: ${entry.path}`)
    if ((await stat(file)).size !== entry.size) throw new Error(`Backup file size mismatch: ${entry.path}`)
    if (entry.sqlite) await assertSqliteIntegrity(file)
  }
  return manifest
}

export async function restoreBackup(options: RestoreBackupOptions): Promise<BackupManifest> {
  const backup = resolve(options.backupDir)
  const rehearsal = resolve(options.rehearsalDir)
  assertProof(options.proof, rehearsal)
  if (isInside(backup, rehearsal) || isInside(rehearsal, backup)) throw new Error('Rehearsal target must be separate from backup')
  await assertFreshDirectory(rehearsal, 'Restore rehearsal target')
  const manifest = await verifyBackup(backup)
  await mkdir(rehearsal, { recursive: true })
  try {
    for (const entry of manifest.entries) {
      const source = join(backup, entry.path)
      const target = join(rehearsal, entry.originalPath)
      assertRelativePath(entry.originalPath)
      assertInside(rehearsal, target)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target)
    }
    await verifyRestored(rehearsal, manifest)
    return manifest
  } catch (error) {
    await rm(rehearsal, { recursive: true, force: true })
    throw error
  }
}

async function verifyRestored(root: string, manifest: BackupManifest) {
  for (const entry of manifest.entries) {
    const file = join(root, entry.originalPath)
    const actual = await sha256File(file)
    if (actual !== entry.sha256) throw new Error(`Restored file hash mismatch: ${entry.originalPath}`)
    if (entry.sqlite) await assertSqliteIntegrity(file)
  }
}

async function snapshot(root: string) {
  const files: Array<{ path: string; relativePath: string; size: number; mtimeMs: number; sqlite: boolean }> = []
  const visit = async (dir: string) => {
    assertInside(root, dir)
    const items = await readdir(dir)
    for (const name of items) {
      const full = join(dir, name)
      assertInside(root, full)
      const item = await lstat(full)
      if (item.isSymbolicLink()) throw new Error('Symlink boundaries are not allowed')
      if (item.isDirectory()) {
        await visit(full)
      } else if (item.isFile()) {
        if (isSqliteSidecar(name)) continue
        const relativePath = relative(root, full)
        assertRelativePath(relativePath)
        files.push({ path: full, relativePath, size: item.size, mtimeMs: item.mtimeMs, sqlite: await isSqliteFile(full) })
      }
    }
  }
  await visit(root)
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return { root, files }
}

function assertUnchanged(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) {
  if (before.files.length !== after.files.length) throw new Error('Source changed during backup')
  for (let index = 0; index < before.files.length; index++) {
    const a = before.files[index]
    const b = after.files[index]
    if (a.relativePath !== b.relativePath || a.size !== b.size || a.mtimeMs !== b.mtimeMs) {
      throw new Error('Source changed during backup')
    }
  }
}

async function copySqlite(source: string, target: string) {
  const db = new DatabaseSync(source, { readOnly: true, timeout: 1000 })
  try {
    await sqliteBackup(db, target)
  } finally {
    db.close()
  }
}

async function assertSqliteIntegrity(file: string) {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 1000 })
  try {
    const row = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined
    const value = row ? Object.values(row)[0] : undefined
    if (value !== 'ok') throw new Error(`SQLite integrity check failed: ${basename(file)}`)
  } finally {
    db.close()
  }
}

async function isSqliteFile(file: string) {
  const handle = await readFile(file).catch(() => Buffer.alloc(0))
  return handle.subarray(0, 16).toString('binary') === 'SQLite format 3\0'
}

function isSqliteSidecar(name: string) {
  return name.endsWith('-wal') || name.endsWith('-shm') || name.endsWith('-journal')
}

async function sha256File(file: string) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

async function assertRealDirectory(path: string, label: string) {
  const item = await lstat(path).catch(() => undefined)
  if (!item?.isDirectory() || item.isSymbolicLink()) throw new Error(`${label} must be a real directory`)
}

async function assertFreshDirectory(path: string, label: string) {
  const item = await lstat(path).catch(() => undefined)
  if (!item) return
  if (!item.isDirectory() || item.isSymbolicLink()) throw new Error(`${label} must be a fresh directory`)
  if ((await readdir(path)).length) throw new Error(`${label} must be fresh and empty`)
}

function parseManifest(content: string): BackupManifest {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error('Backup manifest is malformed')
  }
  if (!value || typeof value !== 'object') throw new Error('Backup manifest is malformed')
  const manifest = value as BackupManifest
  if (manifest.version !== 1 || !Array.isArray(manifest.entries) || typeof manifest.sourceRoot !== 'string') {
    throw new Error('Backup manifest is malformed')
  }
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== 'object') throw new Error('Backup manifest is malformed')
    if (typeof entry.path !== 'string' || typeof entry.originalPath !== 'string') throw new Error('Backup manifest is malformed')
    if (typeof entry.sha256 !== 'string' || typeof entry.size !== 'number' || typeof entry.sqlite !== 'boolean') throw new Error('Backup manifest is malformed')
    assertRelativePath(entry.path)
    assertRelativePath(entry.originalPath)
  }
  return manifest
}

function assertProof(proof: MigrationProof, root: string) {
  const expected = createMigrationProof(root)
  if (proof.root !== expected.root || proof.token !== expected.token) throw new Error('Ownership proof does not match target')
}

function assertRelativePath(value: string) {
  if (!value || value.includes('\0') || value.includes(':') || value.startsWith('/') || value.startsWith('\\')) {
    throw new Error('Unsafe relative path')
  }
  const parts = value.split(/[\\/]+/)
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Unsafe relative path')
}

function assertInside(root: string, candidate: string) {
  if (!isInside(root, candidate) && resolve(root) !== resolve(candidate)) throw new Error('Path escapes root')
}

function isInside(root: string, candidate: string) {
  const rel = relative(resolve(root), resolve(candidate))
  return rel !== '' && !rel.startsWith('..') && !rel.includes(`..${sep}`) && !resolve(rel).startsWith('..')
}
