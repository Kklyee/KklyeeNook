import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { AssistantRuntimeProvider, AuiConfig, Suggestions, Tools } from '@assistant-ui/react'
import { usePiRuntime } from '@assistant-ui/react-pi'
import type { AgentBackendInfo, AgentBackendStatus } from '@/shared/agentBackend'
import { Skeleton } from '../../../components/ui/skeleton'
import { assistantToolkit } from '../tools/AssistantToolkit'
import { ArtifactDataUI } from '../../artifacts/ArtifactRenderer'
import { createElectronPiClient, createElectronPiIpcClient } from './electronPiClient'
import { contextAttachmentAdapter } from '../context/contextAttachmentAdapter'

export function AssistantRuntime({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AgentBackendStatus>({ state: 'starting' })

  useEffect(() => {
    let cancelled = false
    let receivedStatusEvent = false
    const unsubscribe = window.api.agentBackend.onStatus((nextStatus) => {
      receivedStatusEvent = true
      if (!cancelled) setStatus(nextStatus)
    })

    window.api.agentBackend.getStatus().then(
      (nextStatus) => {
        if (!cancelled && !receivedStatusEvent) setStatus(nextStatus)
      },
      () => {
        if (!cancelled && !receivedStatusEvent) {
          setStatus({ state: 'unavailable', message: 'Could not connect to the agent backend.' })
        }
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (status.state === 'starting') {
    return (
      <div className="flex h-full flex-col gap-4 p-8" aria-label="Starting agent backend">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (status.state === 'unavailable') {
    return (
      <section className="flex h-full flex-col justify-center gap-2 p-8" role="alert">
        <h1 className="text-lg font-semibold">Agent backend unavailable</h1>
        <p className="text-sm text-muted-foreground">{status.message}</p>
        <p className="text-sm text-muted-foreground">Restart KklyeeNook to try again.</p>
      </section>
    )
  }

  return <ReadyAssistantRuntime info={status.info}>{children}</ReadyAssistantRuntime>
}

function ReadyAssistantRuntime({
  info,
  children,
}: {
  info: AgentBackendInfo
  children: ReactNode
}) {
  const client = useMemo(
    () =>
      info.transport === 'ipc' ? createElectronPiIpcClient() : createElectronPiClient(info.baseUrl),
    [info.baseUrl, info.transport],
  )
  const runtime = usePiRuntime({
    client,
    adapters: { attachments: contextAttachmentAdapter },
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
      <ArtifactDataUI />
      {children}
    </AssistantRuntimeProvider>
  )
}
