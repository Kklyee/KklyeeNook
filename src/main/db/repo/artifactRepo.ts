import { asc, eq } from 'drizzle-orm'

import type { Artifact, ArtifactDraft } from '@/shared/artifact/artifact'
import type { Database } from '../client'
import { artifacts, type ArtifactRow } from '../schema/artifacts'

export interface ArtifactRepo {
  findById(id: string): Promise<Artifact | undefined>
  findBySessionId(sessionId: string): Promise<Artifact[]>
  findByRunId(runId: string): Promise<Artifact[]>
  save(artifact: Artifact): Promise<void>
}

function toArtifact(row: ArtifactRow): Artifact {
  const payload = JSON.parse(row.payloadJson) as Omit<
    ArtifactDraft,
    'kind' | 'title' | 'targetPath' | 'metadata'
  >
  return {
    ...payload,
    id: row.id,
    sessionId: row.sessionId,
    runId: row.runId,
    toolCallId: row.toolCallId ?? undefined,
    kind: row.kind,
    title: row.title,
    targetPath: row.targetPath ?? undefined,
    metadata: row.metadata,
    createdAt: row.createdAt,
  } as Artifact
}

export class DrizzleArtifactRepo implements ArtifactRepo {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<Artifact | undefined> {
    const [row] = await this.db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1)
    return row ? toArtifact(row) : undefined
  }

  async findBySessionId(sessionId: string): Promise<Artifact[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.sessionId, sessionId))
      .orderBy(asc(artifacts.createdAt))
    return rows.map(toArtifact)
  }

  async findByRunId(runId: string): Promise<Artifact[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.runId, runId))
      .orderBy(asc(artifacts.createdAt))
    return rows.map(toArtifact)
  }

  async save(artifact: Artifact): Promise<void> {
    const {
      id,
      sessionId,
      runId,
      toolCallId,
      kind,
      title,
      targetPath,
      metadata = {},
      createdAt,
      ...payload
    } = artifact
    await this.db
      .insert(artifacts)
      .values({
        id,
        sessionId,
        runId,
        toolCallId,
        kind,
        title,
        targetPath,
        metadata,
        payloadJson: JSON.stringify(payload),
        createdAt,
      })
  }
}
