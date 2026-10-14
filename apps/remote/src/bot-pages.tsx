import { useEffect, useState } from 'react'
import { PlusIcon, Settings2Icon } from 'lucide-react'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'
import { BotEditor } from '@kklyeenook/ui/components/bot-editor'
import { Button } from '@kklyeenook/ui/components/button'
import { defaultBot, type BotProfile } from '@kklyeenook/shared/bot/bot'
import { BOT_STATE_LABELS } from '@kklyeenook/shared/bot/bot-state'
import type { RemoteConversationSnapshot, RemoteState } from '@kklyeenook/shared/remote/index'
import { api, cacheConversation } from './api'
import { useBots } from './bot-provider'
import { ThreadSkeleton } from './Loading'

export const navigateBot = (path: string) => {
  location.hash = path
}

export function BotsPage() {
  const { bots, error, loading } = useBots()
  return (
    <div className="remote-app">
      <header className="flex items-center gap-2 border-b border-border p-5">
        <h1 className="flex-1 text-xl font-semibold">Chat</h1>
        <Button variant="ghost" onClick={() => navigateBot('/bots/new')}>
          <PlusIcon />
          Create Bot
        </Button>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-auto p-5">
        <p className="mb-4 text-xs text-muted-foreground">MY BOTS</p>
        {error && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && <p className="text-sm text-muted-foreground">正在载入 Bots…</p>}
        <div className="space-y-2">
          {bots.map((bot) => (
            <div key={bot.id} className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="h-auto min-h-20 min-w-0 flex-1 justify-start gap-4 rounded-2xl p-3 text-left"
                onClick={() => navigateBot(`/bots/${bot.id}`)}
              >
                <BotAvatar avatar={bot.avatar} name={bot.name} state={bot.state} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-foreground">
                    {bot.name}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {bot.role}
                  </span>
                </span>
                {(bot.state === 'thinking' || bot.state === 'working' || bot.state === 'waiting') && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {BOT_STATE_LABELS[bot.state]}
                  </span>
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`编辑 ${bot.name}`}
                onClick={() => navigateBot(`/bots/${bot.id}/edit`)}
              >
                <Settings2Icon />
              </Button>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

export function BotMainPage({ id }: { id: string }) {
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api<RemoteConversationSnapshot>(`/bots/${id}/main`, 'POST')
      .then((snapshot) => {
        if (!active) return
        cacheConversation(snapshot.id, snapshot)
        navigateBot(`/bots/${id}/conversations/${snapshot.id}`)
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
    return () => {
      active = false
    }
  }, [id])
  return (
    <div className="remote-app">
      <header className="remote-header flex h-[69px] shrink-0 items-center border-b border-border px-3">
        <Button variant="ghost" onClick={() => navigateBot('/')} className="min-h-11">返回 My Bots</Button>
      </header>
      {error ? <p role="alert" className="p-5 text-sm text-destructive">{error}</p> : <ThreadSkeleton />}
    </div>
  )
}

export function EditBotPage({ id, state }: { id: string; state: RemoteState }) {
  const { bots, options, reload } = useBots()
  const [draft] = useState(() => defaultBot(`draft:${crypto.randomUUID()}`, ''))
  const [version, setVersion] = useState(0)
  const profile = id === 'new' ? draft : bots.find((bot) => bot.id === id)
  if (!profile) return <div className="remote-app p-5">正在载入 Bot…</div>
  const action = async (action: 'duplicate' | 'reset') => {
    const result = await api<BotProfile>(`/bots/${id}/${action}`, 'POST')
    await reload()
    if (action === 'duplicate') navigateBot(`/bots/${result.id}/edit`)
    else setVersion((value) => value + 1)
  }
  return (
    <div className="remote-app">
      <BotEditor
        key={`${id}:${version}`}
        profile={profile}
        creating={id === 'new'}
        options={options}
        models={state.models}
        onBack={() => navigateBot(id === 'new' ? '/' : `/bots/${id}`)}
        onSave={async (input, start) => {
          const result = await api<BotProfile>(
            id === 'new' ? '/bots' : `/bots/${id}`,
            id === 'new' ? 'POST' : 'PATCH',
            input,
          )
          await reload()
          navigateBot(start ? `/bots/${result.id}` : `/bots/${result.id}/edit`)
        }}
        onDuplicate={() => action('duplicate')}
        onReset={() => action('reset')}
        onDelete={async () => {
          await api(`/bots/${id}`, 'DELETE', { strategy: 'archive-conversations' })
          await reload()
          navigateBot('/')
        }}
      />
    </div>
  )
}
