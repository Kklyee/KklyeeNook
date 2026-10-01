import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { applyPatch } from 'diff'
import type { Artifact, ArtifactDraft } from '@/shared/artifact/artifact'
import { artifactText } from '@/shared/artifact/artifact'
import type { PermissionMode, PermissionRequest } from '@/shared/approval/permission'
import type { AgentExecutionContext } from '@/shared/workspace/workspace'
import type { Workspace } from '@/shared/workspace/workspace'
import { SandboxService } from '../sandbox/sandboxService'
import type { ArtifactRepo } from '../db/repositories/artifactRepo'

type ArtifactContext = AgentExecutionContext & { mode: PermissionMode }
export class ArtifactService {
  constructor(
    private readonly repo: ArtifactRepo,
    private readonly context: string | ((sessionId: string) => Promise<ArtifactContext>),
    private readonly sandbox = new SandboxService(),
    private readonly getWorkspace?: (id: string) => Promise<Workspace>,
  ) {}
  list(sessionId: string, runId?: string): Promise<Artifact[]> {
    return runId ? this.repo.findByRunId(runId) : this.repo.findBySessionId(sessionId)
  }
  get(artifactId: string): Promise<Artifact | undefined> {
    return this.repo.findById(artifactId)
  }
  async permissionRequest(artifactId: string): Promise<PermissionRequest> {
    const artifact = await this.requireArtifact(artifactId)
    if (artifact.kind === 'table') throw new Error('Table artifacts cannot be applied')
    if (!artifact.targetPath) throw new Error('Artifact does not define a target path')
    const context: ArtifactContext =
      typeof this.context === 'string'
        ? {
            conversationId: artifact.sessionId,
            workspace: { id: '', rootPath: this.context },
            mode: 'workspace-write',
          }
        : await this.context(artifact.sessionId)
    let path = artifact.targetPath
    if (artifact.workspaceId !== undefined) {
      if (artifact.workspaceId) {
        const workspace = await this.getWorkspace?.(artifact.workspaceId)
        if (!workspace?.rootPath || workspace.status !== 'attached')
          throw new Error('Artifact 所属项目不可用')
        path = resolve(workspace.rootPath, path)
      } else {
        path = (await this.sandbox.paths.resolve(path)).path
      }
    }
    return {
      ...context,
      toolName: 'artifact_apply',
      resource: { kind: 'path', path, action: 'artifact-apply' },
    }
  }
  async apply(artifactId: string, approve?: (reason: string) => Promise<boolean>): Promise<string> {
    const artifact = await this.requireArtifact(artifactId)
    const request = await this.permissionRequest(artifactId)
    const decision = await this.sandbox.policy.evaluate(request)
    if (decision.outcome === 'deny') throw new Error(decision.reason)
    const toolCallId = crypto.randomUUID()
    if (decision.outcome === 'ask') {
      if (!approve || !(await approve(decision.reason)))
        throw new Error('用户拒绝本次执行，目标必须保持在工作区内 (inside the workspace)')
      this.sandbox.elevate(toolCallId, request, decision.requestedMode)
    }
    const targetPath = await this.sandbox.resolveFile(request, toolCallId)
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
  private async requireArtifact(id: string): Promise<Artifact> {
    const artifact = await this.repo.findById(id)
    if (!artifact) throw new Error('Artifact not found: ' + id)
    return artifact
  }
}
