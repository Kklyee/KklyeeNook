import { useEffect, useState } from 'react'
import type { GroveConnections } from '@kklyeenook/shared/bot/grove-settings'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

const states = { pending: '等待同意', accepted: '已连接', rejected: '已拒绝', revoked: '已断开' }

export function GroveConnectionsPanel() {
  const [connections, setConnections] = useState<GroveConnections>()
  const [recipient, setRecipient] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const status = await window.api.grove.status()
        if (!status.hasUserCredential) return
        const value = await window.api.grove.connections()
        if (active) setConnections(value)
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '连接列表加载失败')
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setConnections(await window.api.grove.connections())
    } catch (error) {
      setError(error instanceof Error ? error.message : '连接操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="px-5 py-4">
      <h2 className="font-medium">Connections</h2>
      <p className="mt-2 text-xs text-muted-foreground">
        通过 User ID 邀请对方。连接建立后仍需单独授予消息、任务或工具权限。
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          aria-label="邀请的 User ID"
          placeholder="对方的 User ID"
          value={recipient}
          disabled={busy || !connections}
          onChange={(event) => setRecipient(event.target.value)}
        />
        <Button
          size="sm"
          disabled={busy || !connections || !recipient.trim()}
          onClick={() =>
            void act(async () => {
              await window.api.grove.invite(recipient.trim())
              setRecipient('')
            })
          }
        >
          邀请
        </Button>
      </div>
      <div className="mt-3 divide-y">
        {connections?.relationships.map((relationship) => {
          const incoming = relationship.recipientUserId === connections.userId
          const other = incoming ? relationship.requesterUserId : relationship.recipientUserId
          return (
            <div key={relationship.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
              <span className="min-w-0 flex-1 break-all">
                {other}
                <span className="ml-2 text-xs text-muted-foreground">
                  {states[relationship.state]}
                </span>
              </span>
              {relationship.state === 'pending' && incoming && (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        window.api.grove.decide({ id: relationship.id, state: 'accepted' }),
                      )
                    }
                  >
                    同意
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        window.api.grove.decide({ id: relationship.id, state: 'rejected' }),
                      )
                    }
                  >
                    拒绝
                  </Button>
                </>
              )}
              {(relationship.state === 'accepted' ||
                (relationship.state === 'pending' && !incoming)) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      window.api.grove.decide({ id: relationship.id, state: 'revoked' }),
                    )
                  }
                >
                  断开
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {connections && (
        <div className="mt-3 divide-y">
          {connections.bots
            .filter((bot) => bot.ownerUserId !== connections.userId)
            .map((bot) => (
              <div key={bot.networkId} className="py-3 text-sm">
                <p>{bot.name}</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  Bot：{bot.networkId} · Owner：{bot.ownerUserId}
                </p>
              </div>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
