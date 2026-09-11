import type { ReactNode } from 'react'
import { AssistantRuntimeProvider, AuiConfig, Suggestions, Tools } from '@assistant-ui/react'
import { usePiRuntime } from '@assistant-ui/react-pi'
import { assistantToolkit } from '../tools/AssistantToolkit'
import { ArtifactDataUI } from '../../artifacts/ArtifactRenderer'
import { electronPiClient } from './electronPiClient'

export function AssistantRuntime({ children }: { children: ReactNode }) {
  const runtime = usePiRuntime({ client: electronPiClient })

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
      <ArtifactDataUI />
      {children}
    </AssistantRuntimeProvider>
  )
}
