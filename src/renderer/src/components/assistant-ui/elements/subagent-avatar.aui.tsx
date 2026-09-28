import type { SubagentAvatar as SubagentAvatarValue } from '@/shared/agent/delegateTask'
import { cn } from '@/renderer/src/lib/utils'

const avatarTones: Record<SubagentAvatarValue, string> = {
  '🦊': 'from-orange-400/25 to-amber-500/20',
  '🐼': 'from-slate-400/25 to-zinc-500/20',
  '🐸': 'from-emerald-400/25 to-green-500/20',
  '🐨': 'from-sky-400/25 to-slate-500/20',
  '🐰': 'from-pink-400/25 to-rose-500/20',
  '🦉': 'from-violet-400/25 to-indigo-500/20',
  '🐯': 'from-yellow-400/25 to-orange-500/20',
  '🐙': 'from-fuchsia-400/25 to-purple-500/20',
}

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
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ring-1 ring-foreground/10',
        size === 'lg' ? 'size-11 text-2xl' : 'size-6 text-sm',
        avatarTones[avatar],
        className,
      )}
      aria-hidden="true"
    >
      {avatar}
    </span>
  )
}
