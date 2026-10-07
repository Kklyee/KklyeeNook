import { WorkspaceProvider, useWorkspaces } from '../../workspaces/WorkspaceProvider'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AssistantRuntimeProvider, AuiConfig, Suggestions, Tools } from '@assistant-ui/react'
import { usePiRuntime } from '@assistant-ui/react-pi'
import type { AgentBackendInfo, AgentBackendStatus } from '@/shared/agentBackend'
import { Skeleton } from '../../../components/ui/skeleton'
import { assistantToolkit } from '../tools/AssistantToolkit'
import { createElectronPiClient } from './electronPiClient'
import { contextAttachmentAdapter } from '../context/contextAttachmentAdapter'
import { SendStateContext } from './SendState'

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

  return (
    <WorkspaceProvider>
      <ReadyAssistantRuntime info={status.info}>{children}</ReadyAssistantRuntime>
    </WorkspaceProvider>
  )
}

function ReadyAssistantRuntime({
  info,
  children,
}: {
  info: AgentBackendInfo
  children: ReactNode
}) {
  const { getDraftWorkspaceId, getDraftMode } = useWorkspaces()
  const [sending, setSending] = useState({ creating: false, threads: new Set<string>() })
  const onSending = useCallback((id: string | undefined, pending: boolean) => {
    setSending(current => {
      if (!id) return { ...current, creating: pending }
      const threads = new Set(current.threads)
      if (pending) threads.add(id)
      else threads.delete(id)
      return { ...current, threads }
    })
  }, [])
  const client = useMemo(
    () => createElectronPiClient(info.baseUrl, getDraftWorkspaceId, getDraftMode, onSending),
    [info.baseUrl, getDraftWorkspaceId, getDraftMode, onSending],
  )
  const runtime = usePiRuntime({ client, adapters: { attachments: contextAttachmentAdapter } })

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
    <SendStateContext.Provider value={sending}><AssistantRuntimeProvider runtime={runtime} config={config}>
      {children}
    </AssistantRuntimeProvider></SendStateContext.Provider>
  )
}
