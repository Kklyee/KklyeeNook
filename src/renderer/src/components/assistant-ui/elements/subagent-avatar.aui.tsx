import type { SubagentAvatar as SubagentAvatarValue } from '@/shared/agent/delegateTask'
import { cn } from '@/renderer/src/lib/utils'

const avatarTone = 'bg-tool-agent-soft text-tool-agent'

export function SubagentAvatar({
  avatar = '🦊',
  className,
  size = 'sm',
}: {
  avatar?: SubagentAvatarValue
  className?: string
  size?: 'sm' | 'lg'
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        size === 'lg' ? 'size-11 text-2xl' : 'size-5 text-xs',
        avatarTone,
        className,
      )}
      aria-hidden="true"
    >
      {avatar}
    </span>
  )
}
