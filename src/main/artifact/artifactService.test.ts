import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, test } from 'vitest'

import type { Artifact } from '@/shared/artifact/artifact'
import type { ArtifactRepo } from '../db/repositories/artifactRepo'
import { ArtifactService } from './artifactService'

class MemoryArtifactRepo implements ArtifactRepo {
  constructor(readonly artifacts: Artifact[]) {}
  async findById(id: string) {
    return this.artifacts.find((artifact) => artifact.id === id)
  }
  async findBySessionId(sessionId: string) {
    return this.artifacts.filter((artifact) => artifact.sessionId === sessionId)
  }
  async findByRunId(runId: string) {
    return this.artifacts.filter((artifact) => artifact.runId === runId)
  }
  async save(artifact: Artifact) {
    this.artifacts.push(artifact)
  }
}

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'kklyeenook-artifact-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

function artifact(value: Partial<Artifact> & Pick<Artifact, 'kind' | 'title'>): Artifact {
  return {
    id: 'artifact-1',
    sessionId: 'session-1',
    runId: 'run-1',
    createdAt: 1,
    ...value,
  } as Artifact
}

test('applies text and diff artifacts inside the workspace', async () => {
  const code = artifact({ kind: 'code', title: 'Code', content: 'new', targetPath: 'nested/a.txt' })
  const repo = new MemoryArtifactRepo([code])
  const service = new ArtifactService(repo, workspace)
  await service.apply(code.id)
  expect(await readFile(join(workspace, 'nested/a.txt'), 'utf8')).toBe('new')

  await writeFile(join(workspace, 'nested/a.txt'), 'old\n', 'utf8')
  const diff = artifact({
    id: 'artifact-2',
    kind: 'diff',
    title: 'Diff',
    targetPath: 'nested/a.txt',
    patch: '--- a.txt\n+++ a.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n',
  })
  repo.artifacts.push(diff)
  await service.apply(diff.id)
  expect(await readFile(join(workspace, 'nested/a.txt'), 'utf8')).toBe('new\n')
})

test('rejects targets outside the workspace', async () => {
  const outside = artifact({
    kind: 'file',
    title: 'Outside',
    filename: 'x.txt',
    content: 'x',
    targetPath: '../x.txt',
  })
  const service = new ArtifactService(new MemoryArtifactRepo([outside]), workspace)
  await expect(service.apply(outside.id)).rejects.toThrow('inside the workspace')
})
