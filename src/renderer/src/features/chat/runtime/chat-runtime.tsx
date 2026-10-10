import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
  Tools,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import type { PermissionMode } from '@/shared/approval/permission'
import { assistantToolkit } from '../tools/AssistantToolkit'
import { contextAttachmentAdapter } from '../context/contextAttachmentAdapter'
import { useWorkspaces } from '../../workspaces/WorkspaceProvider'
import { SendStateContext } from './SendState'
import { ChatStore, type ChatExtras, type ChatSnapshot } from './chat-store'

type AgentContextValue = {
  store: ChatStore
  snapshot: ChatSnapshot
}

const ChatRuntimeContext = createContext<AgentContextValue | null>(null)

export function ChatRuntimeProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const { getDraftWorkspaceId, getDraftMode } = useWorkspaces()
  const store = useMemo(
    () =>
      new ChatStore(baseUrl, () => ({
        workspaceId: getDraftWorkspaceId(),
        permissionMode: getDraftMode() as PermissionMode | null,
      })),
    [baseUrl, getDraftWorkspaceId, getDraftMode],
  )
  useEffect(() => () => store.dispose(), [store])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const runtime = useExternalStoreRuntime({
    messages: snapshot.current.messages,
    convertMessage: (message) => message,
    isRunning: snapshot.current.projected.isRunning,
    isLoading: snapshot.current.loading,
    isDisabled: snapshot.current.disabled,
    extras: snapshot.extras,
    queue: snapshot.queue,
    adapters: { attachments: contextAttachmentAdapter, threadList: snapshot.threadList },
    onNew: async (message) => {
      await store.submit(message, snapshot.current.projected.isRunning ? (message.steer ? 'steer' : 'followUp') : undefined)
    },
    onCancel: async () => store.cancel(),
    onRefetchThread: async () => store.refresh(),
    onRespondToToolApproval: async ({ approvalId, approved }) => {
      await store.respondToApproval(approvalId, approved)
    },
  })
  const config = AuiConfig({
    tools: Tools({ toolkit: assistantToolkit }),
    suggestions: Suggestions([
      {
        title: '了解项目',
        label: '',
        prompt: '请阅读当前项目，介绍目录结构和主要模块，暂时不要修改文件。',
      },
      {
        title: '解释代码',
        label: '',
        prompt: '请解释当前项目中 Agent 从接收消息到完成回复的流程，暂时不要修改文件。',
      },
      {
        title: '整理文档',
        label: '',
        prompt: '请阅读项目并提出 README 的改进建议，等我确认后再修改。',
      },
    ]),
  })
  return (
    <ChatRuntimeContext.Provider value={{ store, snapshot }}>
      <SendStateContext.Provider value={snapshot.sending}>
        <AssistantRuntimeProvider runtime={runtime} config={config}>{children}</AssistantRuntimeProvider>
      </SendStateContext.Provider>
    </ChatRuntimeContext.Provider>
  )
}

export function useChatRuntimeSnapshot() {
  const context = useContext(ChatRuntimeContext)
  if (!context) throw new Error('Durable runtime is required')
  return context.snapshot
}

export function useChatRuntimeExtras(): ChatExtras {
  return useChatRuntimeSnapshot().extras
}

export function useChatThreadState<T>(selector: (state: ChatExtras) => T): T {
  return selector(useChatRuntimeExtras())
}

export function useChatSession() {
  const snapshot = useChatRuntimeSnapshot()
  const metadata = snapshot.current.metadata
  if (!metadata || !snapshot.selectedThreadId) return undefined
  return {
    id: metadata.id,
    title: metadata.title,
    status: snapshot.current.projected.isRunning ? 'running' : 'idle',
    config: {
      provider: metadata.model?.provider,
      modelId: metadata.model?.modelId,
      thinkingLevel: metadata.thinkingLevel,
    },
  }
}
