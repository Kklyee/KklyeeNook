import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { applyPatch } from 'diff'

import type { Artifact, ArtifactDraft } from '@/shared/artifact/artifact'
import { artifactText } from '@/shared/artifact/artifact'
import type { ArtifactRepo } from '../db/repositories/artifactRepo'

export class ArtifactService {
  constructor(
    private readonly repo: ArtifactRepo,
    private readonly workspace: string | (() => string),
  ) {}

  list(sessionId: string, runId?: string): Promise<Artifact[]> {
    return runId ? this.repo.findByRunId(runId) : this.repo.findBySessionId(sessionId)
  }

  get(artifactId: string): Promise<Artifact | undefined> {
    return this.repo.findById(artifactId)
  }

  async apply(artifactId: string): Promise<string> {
    const artifact = await this.requireArtifact(artifactId)
    if (artifact.kind === 'table') throw new Error('Table artifacts cannot be applied')
    if (!artifact.targetPath) throw new Error('Artifact does not define a target path')

    const targetPath = this.resolveWorkspacePath(artifact.targetPath)
    if (artifact.kind === 'diff') {
      const current = await readFile(targetPath, 'utf8')
      const updated = applyPatch(current, artifact.patch)
      if (updated === false) throw new Error('Patch does not apply cleanly to the current file')
      await writeFile(targetPath, updated, 'utf8')
    } else {
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, artifactText(artifact), 'utf8')
    }
    return targetPath
  }

  exportContent(artifact: ArtifactDraft): string {
    return artifactText(artifact)
  }

  private async requireArtifact(artifactId: string): Promise<Artifact> {
    const artifact = await this.repo.findById(artifactId)
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`)
    return artifact
  }

  private resolveWorkspacePath(path: string): string {
    const workspaceRoot = resolve(
      typeof this.workspace === 'string' ? this.workspace : this.workspace(),
    )
    const target = resolve(workspaceRoot, path)
    const pathFromRoot = relative(workspaceRoot, target)
    if (
      pathFromRoot === '..' ||
      pathFromRoot.startsWith(`..\\`) ||
      pathFromRoot.startsWith('../') ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error('Artifact target must stay inside the workspace')
    }
    return target
  }
}
