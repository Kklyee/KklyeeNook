import { useEffect, useState } from 'react'
import { BotEditor, type BotEditorOptions } from '@kklyeenook/ui/components/bot-editor'
import { defaultBot } from '@kklyeenook/shared/bot/bot'
import type { AgentSettingsSnapshot } from '@kklyeenook/shared/agent/agentSettings'
import { useChatRuntimeSnapshot, useChatStore } from '../chat/runtime/chat-runtime'
import { Button } from '../../components/ui/button'

export function BotManagement({ settings }: { settings: AgentSettingsSnapshot | null }) {
  const store = useChatStore()
  const { botEditorId, bots } = useChatRuntimeSnapshot()
  const [options, setOptions] = useState<BotEditorOptions>()
  const [error, setError] = useState('')
  const [draft] = useState(() => defaultBot(`draft:${crypto.randomUUID()}`, ''))
  const [resetVersion, setResetVersion] = useState(0)
  useEffect(() => {
    let active = true
    store
      .botOptions()
      .then((value) => {
        if (active) setOptions(value)
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
    return () => {
      active = false
    }
  }, [store])
  const profile = botEditorId === 'new' ? draft : bots.find((bot) => bot.id === botEditorId)
  if (!options || !profile)
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => store.editBot(undefined)}>
          返回 Chat
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">{error || '正在载入 Bot 配置…'}</p>
      </div>
    )
  return (
    <BotEditor
      key={`${botEditorId}:${resetVersion}`}
      profile={profile}
      creating={botEditorId === 'new'}
      options={options}
      models={(settings?.models ?? []).map((model) => ({
        provider: model.provider,
        modelId: model.modelID,
        name: model.modelName,
      }))}
      onBack={() => store.editBot(undefined)}
      onSave={async (input, start) => {
        const bot = await store.saveBot(input, botEditorId === 'new' ? undefined : profile.id)
        if (start) await store.selectBot(bot.id)
      }}
      onDuplicate={() => store.duplicateBot(profile.id)}
      onDelete={() => store.deleteBot(profile.id)}
      onReset={async () => {
        await store.resetBot(profile.id)
        setResetVersion((version) => version + 1)
      }}
    />
  )
}
