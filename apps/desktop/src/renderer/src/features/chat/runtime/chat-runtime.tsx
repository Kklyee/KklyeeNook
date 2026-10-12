import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  AssistantRuntimeProvider,
  AuiConfig,
  Tools,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import type { PermissionMode } from '@kklyeenook/shared/approval/permission'
import { assistantToolkit } from '../tools/AssistantToolkit'
import { contextAttachmentAdapter } from '../context/contextAttachmentAdapter'
import { useWorkspaces } from '../../workspaces/WorkspaceProvider'
import { SendStateContext } from './SendState'
import { ChatStore, type ChatExtras, type ChatSnapshot } from './chat-store'

type AgentContextValue = { store: ChatStore; snapshot: ChatSnapshot }

const ChatRuntimeContext = createContext<AgentContextValue | null>(null)

export function ChatRuntimeProvider({
  baseUrl,
  children,
}: {
  baseUrl: string
  children: ReactNode
}) {
  const { getDraftWorkspaceId, getDraftMode } = useWorkspaces()
  const store = useMemo(
    () =>
      new ChatStore(
        baseUrl,
        () => ({
          workspaceId: getDraftWorkspaceId(),
          permissionMode: getDraftMode() as PermissionMode | null,
        }),
        false,
      ),
    [baseUrl, getDraftWorkspaceId, getDraftMode],
  )
  useEffect(() => {
    store.start()
    return () => store.dispose()
  }, [store])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const runtime = useExternalStoreRuntime({
    messages: snapshot.current.messages,
    convertMessage: (message) => message,
    isRunning: snapshot.current.projected.isRunning,
    isLoading: snapshot.current.loading,
    isDisabled:
      snapshot.current.loading ||
      snapshot.sending.creating ||
      !snapshot.selectedBotId ||
      !snapshot.current.metadata,
    extras: snapshot.extras,
    queue: snapshot.queue,
    adapters: { attachments: contextAttachmentAdapter, threadList: snapshot.threadList },
    onNew: async (message) => {
      await store.submit(
        message,
        snapshot.current.projected.isRunning ? (message.steer ? 'steer' : 'followUp') : undefined,
      )
    },
    onCancel: async () => store.cancel(),
    onRefetchThread: async () => store.refresh(),
    onRespondToToolApproval: async ({ approvalId, approved }) => {
      await store.respondToApproval(approvalId, approved)
    },
  })
  const config = AuiConfig({ tools: Tools({ toolkit: assistantToolkit }) })
  return (
    <ChatRuntimeContext.Provider value={{ store, snapshot }}>
      <SendStateContext.Provider value={snapshot.sending}>
        <AssistantRuntimeProvider runtime={runtime} config={config}>
          {children}
        </AssistantRuntimeProvider>
      </SendStateContext.Provider>
    </ChatRuntimeContext.Provider>
  )
}

export function useChatRuntimeSnapshot() {
  const context = useContext(ChatRuntimeContext)
  if (!context) throw new Error('Durable runtime is required')
  return context.snapshot
}

export function useChatStore() {
  const context = useContext(ChatRuntimeContext)
  if (!context) throw new Error('Durable runtime is required')
  return context.store
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
  if (!metadata) return undefined
  return {
    id: metadata.id,
    title: metadata.title,
    status: snapshot.current.projected.isRunning ? 'running' : 'idle',
    config: {
      botId: metadata.botId,
      provider: metadata.model?.provider,
      modelId: metadata.model?.modelId,
      thinkingLevel: metadata.thinkingLevel,
    },
  }
}
