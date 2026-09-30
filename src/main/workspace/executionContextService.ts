import { effectivePermissionMode, type PermissionMode } from '@/shared/approval/permission'
import type { AgentExecutionContext } from '@/shared/workspace/workspace'
import type { AgentSessionRepo } from '../db/repositories/agentSessionRepo'
import type { WorkspaceService } from './workspaceService'

export class ExecutionContextService {
  constructor(
    private readonly sessions: AgentSessionRepo,
    private readonly workspaces: WorkspaceService,
    private readonly defaultMode: () => PermissionMode = () => 'workspace-write',
  ) {}
  async resolve(conversationId: string): Promise<AgentExecutionContext & { mode: PermissionMode }> {
    const session = await this.sessions.findById(conversationId)
    if (!session) throw new Error('会话不存在')
    const workspaceId = session.workspaceId ?? undefined
    if (!workspaceId)
      return {
        conversationId,
        mode: effectivePermissionMode(session.permissionMode, false, this.defaultMode()),
      }
    const workspace = await this.workspaces.resolve(workspaceId)
    return {
      conversationId,
      mode: effectivePermissionMode(
        session.permissionMode,
        workspace.status === 'attached',
        this.defaultMode(),
      ),
      workspaceId,
      ...(workspace.status === 'attached' && workspace.rootPath
        ? { workspace: { id: workspace.id, rootPath: workspace.rootPath } }
        : {}),
    }
  }
}
