import type { PermissionMode } from '@/shared/approval/permission'
import type { SystemMaterial } from '@/shared/platform/systemMaterial'
import type { ThemeMode } from '@/shared/platform/theme'
import type { PreviewWorkspaceFileRequest, WorkspaceFilePreview } from '@/shared/preview/workspacePreview'
import type { AgentSessionSummary } from '@/shared/agent/agentSession'
import type { Workspace, WorkspaceAttachResult } from '@/shared/workspace/workspace'
import type { WindowMenu, WindowMenuAction } from '@/shared/ipc/channels'
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { KnowledgeReadResult, KnowledgeSearchRequest, KnowledgeSearchResult, KnowledgeSource } from '@/shared/knowledge/knowledge'
import type {
  AgentSettingsSnapshot,
  DiscoverModelsRequest,
  ModelCatalogModel,
  TestWebSearchConnectionRequest,
  UpdateAgentModelSelectionRequest,
  UpdateAgentSettingsRequest,
} from '@/shared/agent/agentSettings'
import type { WebSearchConnectionTestResult } from '../shared/web-search/webSearch'
import type { DeletePermissionGrantRequest } from '@/shared/approval/approvalTypes'
import type { AgentRun, AgentRunOverview, LoadAgentRunsRequest } from '../shared/agent/agentRun'
import type {
  AgentExecutionRecord,
  AgentEventEnvelope,
  LoadAgentExecutionRecordsRequest,
} from '../shared/agent/agentExecutionRecord'
import type {
  ContextAttachmentRef,
  RemoveContextAttachmentRequest,
  StageContextAttachmentRequest,
} from '../shared/context/contextAttachment'
import type { AgentBackendStatus } from '../shared/agentBackend'
import type { AgentSkill } from '../shared/agent/agentSkill'
import type { AgentMemory, DeleteAgentMemoryRequest } from '../shared/memory/agentMemory'
import type { McpServerState } from '../shared/mcp/mcpServer'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  UpdateScheduledTaskInput,
} from '../shared/scheduler/scheduledTask'

interface API {
  remote: {
    status(): Promise<import('@kklyeenook/shared/remote/index').RemoteStatus>
    configure(settings: import('@kklyeenook/shared/remote/index').RemoteSettings): Promise<import('@kklyeenook/shared/remote/index').RemoteStatus>
  }
  wallpaper: {
    get(): Promise<string | null>
    choose(): Promise<string | null>
    clear(): Promise<null>
  }
  getSystemMaterial(): SystemMaterial
  onSystemMaterialChanged(listener: (material: SystemMaterial) => void): () => void
  preview: {
    readWorkspaceFile(request: PreviewWorkspaceFileRequest): Promise<WorkspaceFilePreview>
  }
  conversations: {
    compact(id: string, instructions?: string): Promise<void>
    setPermission(id: string, mode: PermissionMode): Promise<AgentSessionSummary>
    list(): Promise<AgentSessionSummary[]>
    create(input: { title?: string; workspaceId: string | null }): Promise<AgentSessionSummary>
  }
  workspaces: {
    list(): Promise<Workspace[]>
    pick(): Promise<WorkspaceAttachResult | null>
    attach(input: { path: string; relinkId?: string; createNew?: boolean }): Promise<WorkspaceAttachResult>
    detach(id: string): Promise<void>
  }
  knowledge: {
    list(): Promise<KnowledgeSource[]>
    add(path: string, kind: KnowledgeSource['kind'], workspaceId?: string): Promise<KnowledgeSource>
    pick(kind: KnowledgeSource['kind'], workspaceId?: string): Promise<KnowledgeSource[]>
    reindex(sourceId: string): Promise<void>
    remove(sourceId: string): Promise<void>
    search(input: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]>
    read(chunkId: string): Promise<KnowledgeReadResult>
    open(chunkId: string): Promise<void>
    droppedFilePath(file: File): string
  }
  window: {
    setMaterialEnabled(enabled: boolean): SystemMaterial
    setTheme(theme: ThemeMode): boolean
    minimize(): void
    toggleMaximize(): void
    isMaximized(): Promise<boolean>
    onMaximizedChanged(listener: (maximized: boolean) => void): () => void
    close(): void
    showMenu(menu: WindowMenu, x: number, y: number): void
    onMenuAction(listener: (action: WindowMenuAction) => void): () => void
  }
  agentBackend: {
    getStatus(): Promise<AgentBackendStatus>
    onStatus(listener: (status: AgentBackendStatus) => void): () => void
  }
  listAgentSkills(): Promise<AgentSkill[]>
  getAgentSkill(id: string): Promise<AgentSkill | null>
  reloadAgentSkills(): Promise<AgentSkill[]>
  listScheduledTasks(): Promise<ScheduledTask[]>
  createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTask>
  updateScheduledTask(id: string, input: UpdateScheduledTaskInput): Promise<ScheduledTask>
  deleteScheduledTask(id: string): Promise<void>
  enableScheduledTask(id: string): Promise<ScheduledTask>
  disableScheduledTask(id: string): Promise<ScheduledTask>
  context: {
    stage(request: StageContextAttachmentRequest): Promise<ContextAttachmentRef>
    remove(request: RemoveContextAttachmentRequest): Promise<void>
  }
  getAgentSettings(): Promise<AgentSettingsSnapshot>
  updateAgentSettings(request: UpdateAgentSettingsRequest): Promise<AgentSettingsSnapshot>
  updateAgentModelSelection(
    request: UpdateAgentModelSelectionRequest,
  ): Promise<AgentSettingsSnapshot>
  discoverModels(request: DiscoverModelsRequest): Promise<ModelCatalogModel[]>
  testWebSearchConnection(
    request: TestWebSearchConnectionRequest,
  ): Promise<WebSearchConnectionTestResult>
  listMcpServers(): Promise<McpServerState[]>
  connectMcpServer(serverId: string): Promise<McpServerState>
  disconnectMcpServer(serverId: string): Promise<void>
  retryMcpServer(serverId: string): Promise<McpServerState>
  listMemories(workspaceId?: string): Promise<AgentMemory[]>
  deleteMemory(request: DeleteAgentMemoryRequest): Promise<void>
  deletePermissionGrant(request: DeletePermissionGrantRequest): Promise<void>
  listAgentRuns(request: LoadAgentRunsRequest): Promise<AgentRun[]>
  onAgentActivityEvent(listener: (envelope: AgentEventEnvelope) => void): () => void
  listAgentRunOverviews(): Promise<AgentRunOverview[]>
  readToolResult(resultRef: string): Promise<import('@/shared/tool/tool').ToolExecutionResult>
  listAgentExecutionRecords(
    request: LoadAgentExecutionRecordsRequest,
  ): Promise<AgentExecutionRecord[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
