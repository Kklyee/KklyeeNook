import { useAui } from '@assistant-ui/react'
import { useEffect, useRef, useState } from 'react'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'
import { defaultBot } from '@kklyeenook/shared/bot/bot'
import { Popover, PopoverContent, PopoverTrigger } from '@kklyeenook/ui/components/popover'
import { useChatStore, useChatRuntimeSnapshot } from '../runtime/chat-runtime'
import { useScrollFollower } from '@/renderer/src/components/assistant-ui/elements/thread-scroll-follower'
import { BotMentionPopover } from './BotMentionPopover'

export function BotMentionChip({
  botId,
  displayName,
  navigate = true,
}: {
  botId: string
  displayName: string
  navigate?: boolean
}) {
  const { bots } = useChatRuntimeSnapshot()
  const store = useChatStore()
  const aui = useAui()
  const bot = bots.find((bot) => bot.id === botId)
  const name = bot?.name ?? displayName
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const close = () => {
    clearTimeout(timer.current)
    setOpen(false)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<button type="button" />}
        data-bot-id={botId}
        className="relative mx-0.5 inline-flex max-w-full items-baseline rounded-md border border-border/70 bg-transparent py-0.5 pr-1.5 pl-7 align-baseline text-[0.8em] leading-normal font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${name}${bot ? '' : ' · 不可用'}`}
        onMouseEnter={() => {
          timer.current = setTimeout(() => setOpen(true), 250)
        }}
        onMouseLeave={close}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={(event) => {
          event.preventDefault()
          if (!navigate || !bot) return
          void store
            .navigateMention(
              bot.id,
              aui.composer.getState().text,
              document.querySelector<HTMLElement>('[data-slot^="aui_thread-viewport"]')?.scrollTop,
            )
            .then(() => aui.composer.setText(''))
        }}
      >
        <span className="absolute top-1/2 left-1.5 flex -translate-y-1/2">
          <BotAvatar avatar={bot?.avatar ?? defaultBot(botId, name).avatar} name={name} size={18} />
        </span>
        <span className="truncate">{name}</span>
      </PopoverTrigger>
      <PopoverContent
        initialFocus={false}
        finalFocus={false}
        className="w-64"
        onMouseEnter={() => clearTimeout(timer.current)}
      >
        <BotMentionPopover bot={bot} />
      </PopoverContent>
    </Popover>
  )
}

export function MentionNavigation() {
  const { pause } = useScrollFollower()
  const store = useChatStore()
  const { mentionReturn } = useChatRuntimeSnapshot()
  const aui = useAui()
  if (!mentionReturn) return null
  return (
    <button
      type="button"
      className="text-xs text-muted-foreground hover:text-foreground"
      onClick={() => {
        void store.returnFromMention().then((text) => {
          aui.composer.setText(text)
          requestAnimationFrame(() => {
            pause()
            const viewport = document.querySelector<HTMLElement>(
              '[data-slot^="aui_thread-viewport"]',
            )
            if (viewport && mentionReturn.scrollTop !== undefined)
              viewport.scrollTop = mentionReturn.scrollTop
          })
        })
      }}
    >
      ← 返回来源会话
    </button>
  )
}
