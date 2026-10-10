import { WorkspaceProvider } from '../../workspaces/WorkspaceProvider'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type { AgentBackendInfo, AgentBackendStatus } from '@/shared/agentBackend'
import { Skeleton } from '../../../components/ui/skeleton'
import { ChatRuntimeProvider } from './chat-runtime'

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
  return <ChatRuntimeProvider baseUrl={info.baseUrl}>{children}</ChatRuntimeProvider>
}
