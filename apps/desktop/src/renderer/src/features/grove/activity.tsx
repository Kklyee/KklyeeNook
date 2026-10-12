import { useEffect, useState } from 'react'

type Event = { id: string; title: string; detail: string; time: number }

export function GroveActivityPanel() {
  const [events, setEvents] = useState<Event[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        if (!(await window.api.grove.status()).hasUserCredential) return
        const [connections, tools] = await Promise.all([
          window.api.grove.connections(),
          window.api.grove.sharedTools(),
        ])
        const names = (id: string) =>
          connections.bots.find((bot) => bot.networkId === id)?.name ?? id
        const entries: Event[] = [
          ...tools.operations.map(({ operation, server }) => ({
            id: operation.id,
            title: `${operation.action} · ${names(operation.targetBotId)} · ${operation.state}`,
            detail: `${operation.subject.type}: ${operation.subject.id} · MCP: ${server.id} · Grant: ${operation.grantId ?? ''}${operation.error ? ` · ${operation.error}` : ''}`,
            time: operation.updatedAt,
          })),
          ...connections.relationships.map((relation) => ({
            id: relation.id,
            title: `连接 · ${relation.state}`,
            detail: `${relation.requesterUserId} → ${relation.recipientUserId}`,
            time: relation.updatedAt,
          })),
          ...connections.grants.map((grant) => ({
              id: grant.id,
              title: `${grant.revokedAt ? '撤销授权' : '授予权限'} · ${names(grant.targetBotId)}`,
              detail: `${grant.subject.type}: ${grant.subject.id} · ${grant.actions.join(', ')}`,
              time: grant.revokedAt ?? grant.createdAt,
            })),
        ]
        if (active) {
          setEvents(entries.sort((a, b) => b.time - a.time))
          setError('')
        }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '审计活动读取失败')
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  return (
    <section className="p-5">
      <h2 className="font-medium">授权与能力管理记录</h2>
      <div className="mt-3 divide-y">
        {events.map((event) => (
          <div key={event.id} className="py-3 text-sm">
            <p>{event.title}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">{event.detail}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(event.time).toLocaleString()} · {event.id}
            </p>
          </div>
        ))}
      </div>
      {events.length === 0 && <p className="mt-3 text-sm text-muted-foreground">暂无管理记录。</p>}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
