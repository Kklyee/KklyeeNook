import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { Context } from '@earendil-works/chord'
type SessionHeader = { type: 'session'; id: string; timestamp?: string; version?: number; [key: string]: unknown }
type SessionEntry = { type: string; id: string; parentId: string | null; timestamp: string; message?: Record<string, unknown>; [key: string]: unknown }
type FileEntry = SessionHeader | SessionEntry

import type { PermissionMode } from '@/shared/approval/permission'
import type { AgentMessageProjection, AgentMessageRole } from '@/shared/agent/agentMessage'
import type { AgentMessageRepo } from '../db/repositories/agentMessageRepo'
import type { AgentSessionRecord } from '../db/repositories/agentSessionRepo'
import type { HistorySnapshot } from './history'

export type LegacyHistorySourceKind = 'legacy-jsonl' | 'drizzle-message' | 'diagnostic'

export type LegacyHistoryRecordKind = 'header' | 'message' | 'event' | 'diagnostic'

export type LegacyHistoryEntryRecord = {
  id: string
  parentId: string | null
  kind: LegacyHistoryRecordKind
  role: AgentMessageRole | 'tool' | 'event' | 'diagnostic'
  createdAt: number
  readonly: true
  inert: true
  agentTaskId: null
  source: {
    kind: LegacyHistorySourceKind
    threadId: string
    sessionFile?: string
    entryType?: string
    line?: number
  }
  payload: unknown
}

export type LegacySourceMetadata = {
  title?: string
  workspaceId?: string | null
  permissionMode?: PermissionMode | null
}

export type LegacyHistoryOptions = {
  resolveSourceMetadata?: (threadId: string) => Promise<LegacySourceMetadata | undefined>
  now?: () => number
}

export type LegacyContinuationHost = {
  create(
    input: {
      threadId: string
      title?: string
      workspaceId?: string | null
      permissionMode?: PermissionMode
      history?: HistorySnapshot
    },
    context: Context,
  ): Promise<AgentSessionRecord>
  historySnapshot?(threadId: string, context: Context): Promise<Readonly<HistorySnapshot> | undefined>
}

export type LegacyContinuationResult = {
  record: AgentSessionRecord
  sourceThreadId: string
  newThreadId: string
  imported: boolean
  entryCount: number
}

type ParsedSessionFile = {
  path: string
  header: SessionHeader
  entries: SessionEntry[]
  diagnostics: LegacyHistoryEntryRecord[]
}

export class LegacyHistory {
  private readonly root: string

  constructor(
    sessionDir: string,
    private readonly messageRepo?: AgentMessageRepo,
    private readonly options: LegacyHistoryOptions = {},
  ) {
    this.root = resolve(sessionDir)
  }

  async read(threadId: string): Promise<LegacyHistoryEntryRecord[]> {
    assertThreadId(threadId)
    const legacy = await this.findLegacySession(threadId)
    if (legacy) return this.recordsFromLegacy(legacy, threadId)
    if (!this.messageRepo) return []
    return (await this.messageRepo.findBySessionId(threadId)).map((message) => ({
      id: message.id,
      parentId: message.parentId,
      kind: 'message',
      role: message.role,
      createdAt: message.createdAt,
      readonly: true,
      inert: true,
      agentTaskId: null,
      source: { kind: 'drizzle-message', threadId, entryType: message.role },
      payload: message.payload,
    }))
  }

  async continue(
    host: LegacyContinuationHost,
    sourceThreadId: string,
    newThreadId: string,
    context: Context,
  ): Promise<LegacyContinuationResult> {
    assertThreadId(sourceThreadId)
    assertThreadId(newThreadId)
    if (sourceThreadId === newThreadId) throw new Error('Continuation thread must be independent')
    if (!this.options.resolveSourceMetadata) throw new Error('Legacy source metadata resolver is required')
    const metadata = await this.options.resolveSourceMetadata(sourceThreadId)
    if (!metadata) throw new Error('Legacy source metadata not found')
    const previous = await host.historySnapshot?.(newThreadId, context)
    if (previous && previous.sourceThreadId !== sourceThreadId) throw new Error('Continuation target already exists')
    const source = previous ? [...previous.records] : await this.read(sourceThreadId)
    const record = await host.create(
      {
        threadId: newThreadId,
        title: metadata.title ? `${metadata.title} (continued)` : '继续旧会话',
        workspaceId: metadata.workspaceId ?? null,
        permissionMode: metadata.permissionMode ?? undefined,
        history: { sourceThreadId, records: source },
      },
      context,
    )
    if (!this.messageRepo) return { record, sourceThreadId, newThreadId, imported: false, entryCount: source.length }
    const existing = await this.messageRepo.findBySessionId(newThreadId)
    const handoffId = continuationHandoffId(sourceThreadId)
    if (existing.some((message) => message.id === handoffId)) {
      return { record, sourceThreadId, newThreadId, imported: false, entryCount: existing.length }
    }
    if (existing.length) throw new Error('Continuation target already has messages')
    await this.messageRepo.replaceBySession(
      newThreadId,
      this.continuationProjections(newThreadId, sourceThreadId, source),
    )
    return { record, sourceThreadId, newThreadId, imported: true, entryCount: source.length }
  }

  private async findLegacySession(threadId: string): Promise<ParsedSessionFile | undefined> {
    const files = await listJsonlFiles(this.root)
    const matches: Array<ParsedSessionFile & { modified: number }> = []
    for (const file of files) {
      const parsed = await parseLegacySessionFile(file, threadId)
      if (!parsed) continue
      matches.push({ ...parsed, modified: (await stat(file)).mtimeMs })
    }
    matches.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path))
    return matches[0]
  }

  private recordsFromLegacy(parsed: ParsedSessionFile, threadId: string): LegacyHistoryEntryRecord[] {
    const branch = selectedBranch(parsed.entries)
    const headerTime = Date.parse(parsed.header.timestamp ?? '')
    const records: LegacyHistoryEntryRecord[] = [
      {
        id: `header:${parsed.header.id}`,
        parentId: null,
        kind: 'header',
        role: 'event',
        createdAt: Number.isNaN(headerTime) ? 0 : headerTime,
        readonly: true,
        inert: true,
        agentTaskId: null,
        source: { kind: 'legacy-jsonl', threadId, sessionFile: parsed.path, entryType: 'session' },
        payload: parsed.header,
      },
    ]
    for (const entry of branch) records.push(recordFromEntry(entry, threadId, parsed.path))
    records.push(...parsed.diagnostics)
    return records
  }

  private continuationProjections(
    sessionId: string,
    sourceThreadId: string,
    records: readonly LegacyHistoryEntryRecord[],
  ): AgentMessageProjection[] {
    const now = this.options.now?.() ?? Date.now()
    const projections: AgentMessageProjection[] = []
    let parentId: string | null = null
    const push = (message: Omit<AgentMessageProjection, 'sessionId' | 'parentId'>) => {
      projections.push({ ...message, sessionId, parentId })
      parentId = message.id
    }
    push({
      id: continuationHandoffId(sourceThreadId),
      role: 'system',
      createdAt: now,
      payload: {
        role: 'system',
        content: [{ type: 'text', text: continuationText(sourceThreadId, records.length) }],
        timestamp: now,
        legacyContinuation: { sourceThreadId, readonly: true, inert: true },
      },
    })
    for (const record of records) {
      if (record.kind === 'diagnostic') continue
      const role = record.role === 'user' || record.role === 'assistant' ? record.role : 'system'
      push({
        id: `legacy:${hashId(`${sourceThreadId}:${record.id}`)}`,
        role,
        createdAt: record.createdAt || now,
        payload: projectionPayload(record, now),
      })
    }
    return projections
  }
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const rootStat = await lstat(root).catch(() => undefined)
  if (!rootStat) return []
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Legacy session root must be a real directory')
  const output: string[] = []
  const visit = async (dir: string) => {
    assertInside(root, dir)
    const items = await readdir(dir)
    for (const name of items) {
      const full = join(dir, name)
      assertInside(root, full)
      const item = await lstat(full)
      if (item.isSymbolicLink()) throw new Error('Legacy session symlinks are not allowed')
      if (item.isDirectory()) await visit(full)
      else if (item.isFile() && name.endsWith('.jsonl')) output.push(full)
    }
  }
  await visit(root)
  return output
}

async function parseLegacySessionFile(path: string, threadId: string): Promise<ParsedSessionFile | undefined> {
  const content = await readFile(path, 'utf8').catch(() => undefined)
  if (content === undefined) return undefined
  const raw: FileEntry[] = []
  const diagnostics: LegacyHistoryEntryRecord[] = []
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.trim()) continue
    try {
      const entry: unknown = JSON.parse(line)
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !('type' in entry) || typeof entry.type !== 'string') throw new Error('Invalid legacy entry')
      if (entry.type === 'session' && (!('id' in entry) || typeof entry.id !== 'string')) throw new Error('Invalid legacy session header')
      if (entry.type === 'message' && (!('message' in entry) || !entry.message || typeof entry.message !== 'object' || Array.isArray(entry.message))) throw new Error('Invalid legacy message')
      if (entry.type !== 'session' && ((raw[0] as SessionHeader | undefined)?.version ?? 1) >= 2 && (!('id' in entry) || typeof entry.id !== 'string')) throw new Error('Invalid legacy entry ID')
      raw.push(entry as FileEntry)
    } catch (error) {
      diagnostics.push(diagnosticRecord(threadId, path, index + 1, error))
    }
  }
  if (!raw.length) return undefined
  const first = raw[0]
  if (first.type !== 'session' || typeof first.id !== 'string' || first.id !== threadId) return undefined
  const migrated = raw.map((entry) => structuredClone(entry))
  deterministicV1Migration(migrated)
  const header = migrated.find((entry): entry is SessionHeader => entry.type === 'session')
  if (!header || header.id !== threadId) return undefined
  const entries = migrated.filter((entry): entry is SessionEntry => entry.type !== 'session' && typeof entry.id === 'string')
  return { path, header, entries, diagnostics }
}

function deterministicV1Migration(entries: FileEntry[]) {
  const header = entries.find((entry): entry is SessionHeader => entry.type === 'session')
  if ((header?.version ?? 1) >= 2) return
  let previous: string | null = null
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] as Record<string, unknown>
    if (entry.type === 'session') {
      entry.version = 2
      continue
    }
    const id = typeof entry.id === 'string' ? entry.id : `legacy-${index}`
    entry.id = id
    entry.parentId = previous
    previous = id
    if (entry.type === 'compaction' && typeof entry.firstKeptEntryIndex === 'number') {
      const kept = entries[entry.firstKeptEntryIndex]
      if (kept && kept.type !== 'session') entry.firstKeptEntryId = (kept as Record<string, unknown>).id
      delete entry.firstKeptEntryIndex
    }
  }
}

function selectedBranch(entries: SessionEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const branch: SessionEntry[] = []
  let current: SessionEntry | undefined = entries[entries.length - 1]
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    branch.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return branch.reverse()
}

function recordFromEntry(entry: SessionEntry, threadId: string, sessionFile: string): LegacyHistoryEntryRecord {
  const createdAt = Date.parse(entry.timestamp)
  const message = entry.type === 'message' ? entry.message : undefined
  const role = legacyRole(entry, message)
  return {
    id: entry.id,
    parentId: entry.parentId,
    kind: entry.type === 'message' ? 'message' : 'event',
    role,
    createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
    readonly: true,
    inert: true,
    agentTaskId: null,
    source: { kind: 'legacy-jsonl', threadId, sessionFile, entryType: entry.type },
    payload: entry,
  }
}

function legacyRole(entry: SessionEntry, message: Record<string, unknown> | undefined): LegacyHistoryEntryRecord['role'] {
  if (message?.role === 'user') return 'user'
  if (message?.role === 'assistant') return 'assistant'
  if (message?.role === 'toolResult' || message?.role === 'bashExecution') return 'tool'
  if (entry.type === 'custom_message') return 'system'
  return 'event'
}

function diagnosticRecord(threadId: string, sessionFile: string, line: number, error: unknown): LegacyHistoryEntryRecord {
  return {
    id: `diagnostic:${hashId(`${sessionFile}:${line}`)}`,
    parentId: null,
    kind: 'diagnostic',
    role: 'diagnostic',
    createdAt: 0,
    readonly: true,
    inert: true,
    agentTaskId: null,
    source: { kind: 'diagnostic', threadId, sessionFile, line, entryType: 'malformed-jsonl' },
    payload: { message: error instanceof Error ? error.message : String(error) },
  }
}

function projectionPayload(record: LegacyHistoryEntryRecord, timestamp: number) {
  if (record.role === 'user' || record.role === 'assistant') {
    const message = (record.payload as { message?: unknown }).message
    if (message && typeof message === 'object') {
      return { ...(message as Record<string, unknown>), legacyReadonly: true, legacySource: record.source }
    }
  }
  return {
    role: 'system',
    content: [{ type: 'text', text: displayText(record) }],
    timestamp,
    legacyReadonly: true,
    legacyRole: record.role,
    legacySource: record.source,
    legacyPayload: record.payload,
  }
}

function displayText(record: LegacyHistoryEntryRecord) {
  if (record.kind === 'header') return `Legacy session ${record.source.threadId}`
  if (record.role === 'tool') return `Legacy tool output preserved as read-only history: ${record.source.entryType}`
  return `Legacy event preserved as read-only history: ${record.source.entryType}`
}

function continuationText(sourceThreadId: string, entryCount: number) {
  return `This conversation continues from legacy session ${sourceThreadId}. The imported ${entryCount} history records are read-only and inert. No tools or model tasks were replayed.`
}

function continuationHandoffId(sourceThreadId: string) {
  return `legacy-handoff:${hashId(sourceThreadId)}`
}

function assertThreadId(threadId: string) {
  if (!/^(?=.*[A-Za-z_-])[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(threadId)) {
    throw new Error('Invalid legacy thread ID')
  }
}

function assertInside(root: string, candidate: string) {
  const rel = relative(resolve(root), resolve(candidate))
  if (rel.startsWith('..') || rel === '..' || rel === '' && resolve(root) !== resolve(candidate)) {
    throw new Error('Path escapes legacy session root')
  }
}

function hashId(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

export const legacyHistoryInternals = { assertThreadId, selectedBranch, continuationHandoffId }
