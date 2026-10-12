import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  ComposerPrimitive,
  useAui,
  useAuiState,
  unstable_useTriggerPopoverScopeContext,
} from '@assistant-ui/react'
import { LexicalComposerInput, type DirectiveChipProps } from '@assistant-ui/react-lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_NORMAL, KEY_ENTER_COMMAND } from 'lexical'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'
import { defaultBot } from '@kklyeenook/shared/bot/bot'
import {
  botMentionFormatter,
  decodeBotMentions,
  type MentionTarget,
} from '@kklyeenook/shared/bot/mentions'
import { useChatStore, useChatRuntimeSnapshot } from '../runtime/chat-runtime'

const Targets = createContext<MentionTarget[]>([])

function UnavailableBots({ row }: { row: (bot: MentionTarget) => React.ReactNode }) {
  const targets = useContext(Targets)
  const { query } = unstable_useTriggerPopoverScopeContext()
  return targets
    .filter(
      (bot) =>
        !bot.allowed && `${bot.name} ${bot.botId}`.toLowerCase().includes(query.toLowerCase()),
    )
    .map((bot) => (
      <div
        key={bot.botId}
        aria-disabled="true"
        className="flex items-center gap-2 px-2 py-1.5 opacity-60"
        title={bot.botId}
      >
        {row(bot)}
        <span className="max-w-40 text-[11px] text-muted-foreground">
          {bot.reason ?? '未授权，请联系所有者授权'}
        </span>
      </div>
    ))
}

function MentionChip({ directiveId, directiveType, label }: DirectiveChipProps) {
  const bot = useContext(Targets).find((bot) => bot.botId === directiveId)
  if (directiveType !== 'bot') return <span className="text-sm">{label}</span>
  return (
    <span
      data-bot-id={directiveId}
      className={`mx-0.5 inline-flex items-center gap-1 rounded-md bg-hover px-1.5 py-0.5 align-middle text-xs font-medium ${bot && !bot.allowed ? 'text-destructive' : ''}`}
      title={`${directiveId}${bot && !bot.allowed ? ` · ${bot.reason}` : ''}`}
    >
      <BotAvatar
        avatar={bot?.avatar ?? defaultBot(directiveId, label).avatar}
        name={label}
        size={18}
      />
      {label}
    </span>
  )
}

function SubmitPlugin({ submit }: { submit: (steer?: boolean) => Promise<void> }) {
  const [editor] = useLexicalComposerContext()
  const aui = useAui()
  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || event.isComposing || editor.isComposing()) return false
          if (event.shiftKey && !(event.ctrlKey || event.metaKey)) return false
          if (!aui.composer.getState().canSend) return false
          event.preventDefault()
          void submit(event.shiftKey && (event.ctrlKey || event.metaKey))
          return true
        },
        COMMAND_PRIORITY_NORMAL,
      ),
    [editor, aui, submit],
  )
  return null
}

export function BotMentionInput({
  placeholder,
  autoFocus,
  submit,
}: {
  placeholder: string
  autoFocus: boolean
  submit: (steer?: boolean) => Promise<void>
}) {
  const store = useChatStore()
  const { selectedThreadId } = useChatRuntimeSnapshot()
  const text = useAuiState((state) => state.composer.text)
  const [targets, setTargets] = useState<MentionTarget[]>([])
  const [error, setError] = useState('')
  const count = decodeBotMentions(text).mentions.length
  useEffect(() => {
    let active = true
    setTargets([])
    const refresh = async () => {
      try {
        const result = await store.mentionTargets()
        if (active) {
          setTargets(result)
          setError('')
        }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : 'Bot 列表加载失败')
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [store, selectedThreadId])
  const adapter = useMemo(
    () => ({
      categories: () => [],
      categoryItems: () => [],
      search: (query: string) =>
        count >= 3
          ? []
          : targets
              .filter(
                (bot) =>
                  bot.allowed &&
                  `${bot.name} ${bot.botId}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((bot) => ({
                id: bot.botId,
                label: bot.name,
                type: 'bot',
                description: bot.role,
              })),
    }),
    [targets, count],
  )
  const row = (bot: MentionTarget) => (
    <>
      <BotAvatar
        avatar={bot.avatar ?? defaultBot(bot.botId, bot.name).avatar}
        name={bot.name}
        size={26}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{bot.name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {bot.role} ·{' '}
          {bot.source === 'local' ? '本地' : bot.owned ? '我的 Bot · 远程' : '已连接 · 远程'}
          {!bot.online && bot.allowed ? ' · 离线，等待上线投递' : ''}
        </span>
      </span>
    </>
  )
  return (
    <Targets.Provider value={targets}>
      <LexicalComposerInput
        formatter={botMentionFormatter}
        directiveChip={MentionChip}
        placeholder={placeholder}
        autoFocus={autoFocus}
        submitMode="none"
        aria-label="Message input"
        className="aui-composer-input max-h-48 min-h-11 w-full overflow-y-auto px-3 py-1 text-[15px] leading-6 outline-none [&_[contenteditable]]:min-h-11 [&_[contenteditable]]:outline-none"
      >
        <SubmitPlugin submit={submit} />
      </LexicalComposerInput>
      <ComposerPrimitive.Unstable_TriggerPopover
        char="@"
        adapter={adapter}
        className="material-raised absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-xl p-1.5"
        aria-label="提及 Bot"
      >
        <ComposerPrimitive.Unstable_TriggerPopover.Directive formatter={botMentionFormatter} />
        <div className="flex justify-between px-2 py-1 text-[11px] text-muted-foreground">
          <span>提及 Bot</span>
          <span>Esc 关闭 · 最多 3 个</span>
        </div>
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {(items) => (
            <>
              {items.map((item, index) => (
                <ComposerPrimitive.Unstable_TriggerPopoverItem
                  key={item.id}
                  item={item}
                  index={index}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover data-[highlighted]:bg-hover"
                  title={item.id}
                >
                  {row(targets.find((bot) => bot.botId === item.id)!)}
                </ComposerPrimitive.Unstable_TriggerPopoverItem>
              ))}
              {count >= 3 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  已达到 3 个 Bot 的上限，删除一个提及后可继续选择。
                </p>
              )}
              <UnavailableBots row={row} />
              {error && (
                <p role="alert" className="px-2 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
            </>
          )}
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>
    </Targets.Provider>
  )
}
