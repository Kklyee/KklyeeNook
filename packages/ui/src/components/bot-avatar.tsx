import Avatar from 'boring-avatars'
import type { BotAvatarConfig, BotState } from '@kklyeenook/shared/bot/bot'
import { BOT_STATE_LABELS } from '@kklyeenook/shared/bot/bot-state'

export function BotAvatar({
  avatar,
  name,
  size = 40,
  state = 'idle',
}: {
  avatar: BotAvatarConfig
  name: string
  size?: number
  state?: BotState
}) {
  return (
    <span
      className="bot-avatar relative inline-flex shrink-0"
      data-state={state}
      role="img"
      aria-label={`${name} · ${BOT_STATE_LABELS[state]}`}
      style={{ width: size, height: size }}
    >
      <Avatar
        name={avatar.seed}
        variant={avatar.variant}
        colors={avatar.colors}
        size={size}
        className="size-full"
        aria-hidden="true"
      />
      {state === 'waiting' && (
        <span
          className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-background"
          aria-hidden="true"
        >
          !
        </span>
      )}
    </span>
  )
}
