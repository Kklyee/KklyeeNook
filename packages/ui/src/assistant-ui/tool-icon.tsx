'use client'

import { BotIcon, CircleAlertIcon, GlobeIcon, WrenchIcon } from 'lucide-react'

import bashIcon from '../assets/icon/bash.svg'
import thinkingIcon from '../assets/icon/thinking.svg'
import editFileIcon from '../assets/icon/edit-file.svg'
import readFileIcon from '../assets/icon/read-file.svg'
import searchIcon from '../assets/icon/tool-search.svg'
import globIcon from '../assets/icon/tool-glob.svg'
import writeFileIcon from '../assets/icon/write-file.svg'
import { cn } from '../lib/utils'

export type ToolIconKind =
  | 'thinking'
  | 'read'
  | 'bash'
  | 'edit'
  | 'write'
  | 'search'
  | 'glob'
  | 'web_search'
  | 'agent'
  | 'generic'

const iconAssets: Partial<Record<ToolIconKind, string>> = {
  thinking: thinkingIcon,
  read: readFileIcon,
  bash: bashIcon,
  edit: editFileIcon,
  write: writeFileIcon,
  search: searchIcon,
  glob: globIcon,
}

export function getToolIconKind(toolName: string): ToolIconKind {
  const name = toolName.toLowerCase()
  if (name === 'grep') return 'search'
  if (name === 'find') return 'glob'
  if (name.includes('read')) return 'read'
  if (name.includes('bash') || name.includes('shell') || name.includes('command')) return 'bash'
  if (name.includes('edit')) return 'edit'
  if (name.includes('write')) return 'write'
  if (name.includes('delegate') || name.includes('subagent')) return 'agent'
  return 'generic'
}

export function ToolIcon({ kind }: { kind: ToolIconKind }) {
  const icon = iconAssets[kind]
  const className = 'size-3.5 shrink-0 text-muted-foreground'

  if (icon) {
    return (
      <span
        aria-hidden="true"
        className={cn('shrink-0 bg-current', className)}
        style={{
          maskImage: `url("${icon}")`,
          maskPosition: 'center',
          maskRepeat: 'no-repeat',
          maskSize: 'contain',
          WebkitMaskImage: `url("${icon}")`,
          WebkitMaskPosition: 'center',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
        }}
      />
    )
  }

  const Icon = kind === 'agent' ? BotIcon : kind === 'web_search' ? GlobeIcon : WrenchIcon
  return <Icon aria-hidden="true" strokeWidth={1.5} className={className} />
}

export function ActivityIcon({ type, status }: { type: string; status: string }) {
  const running = status === 'running'
  if (status !== 'failed' && type !== 'approval' && type !== 'tool')
    return (
      <span className={cn('flex shrink-0', running && 'animate-pulse motion-reduce:animate-none')}>
        <ToolIcon kind={type === 'shell' ? 'bash' : (type as ToolIconKind)} />
      </span>
    )
  const Icon = status === 'failed' || type === 'approval' ? CircleAlertIcon : WrenchIcon
  return (
    <Icon
      aria-hidden="true"
      strokeWidth={1.5}
      className={cn(
        'size-3.5 shrink-0 text-muted-foreground',
        running && 'animate-pulse motion-reduce:animate-none',
      )}
    />
  )
}
