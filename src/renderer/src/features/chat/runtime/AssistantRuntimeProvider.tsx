import { useMemo, type ReactNode } from 'react'
import {
  AssistantRuntimeProvider,
  AuiConfig,
  Suggestions,
  Tools,
  useAui,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react'
import { assistantToolkit } from '../tools/AssistantToolkit'
import { createChatModelAdapter } from './chatModelAdapter'
import { threadListAdapter } from './threadListAdapter'
import { createThreadHistoryAdapter } from './threadHistoryAdapter'

function useAgentThreadRuntime() {
  const aui = useAui()

  const resolveSessionId = useMemo(
    () => async () => {
      const { remoteId } = await aui.threadListItem.initialize()
      return remoteId
    },
    [aui],
  )

  const chatModel = useMemo(() => createChatModelAdapter(resolveSessionId), [resolveSessionId])

  const history = useMemo(
    () =>
      createThreadHistoryAdapter({
        getSessionId: () => aui.threadListItem.getState().remoteId,
        ensureSessionId: resolveSessionId,
      }),
    [aui, resolveSessionId],
  )

  return useLocalRuntime(chatModel, { adapters: { history } })
}

export function AssistantRuntime({ children }: { children: ReactNode }) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useAgentThreadRuntime,
    adapter: threadListAdapter,
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
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      {children}
    </AssistantRuntimeProvider>
  )
}
