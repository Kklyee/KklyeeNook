import type { BotSummary } from '@kklyeenook/shared/bot/bot'
import { BotAvatar } from '@kklyeenook/ui/components/bot-avatar'

export function BotMentionPopover({ bot }: { bot?: BotSummary }) {
  if (!bot) return <span className="text-muted-foreground">Bot 已不可用</span>
  return (
    <div className="flex items-center gap-2">
      <BotAvatar avatar={bot.avatar} name={bot.name} size={32} />
      <div className="min-w-0">
        <div className="truncate font-medium">{bot.name}</div>
        <div className="text-xs text-muted-foreground">{bot.role}</div>
        <div className="text-xs text-muted-foreground">本地 Bot · {bot.state}</div>
      </div>
    </div>
  )
}
