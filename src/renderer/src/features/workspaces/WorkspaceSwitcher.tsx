import { useState } from 'react'
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  ListTreeIcon,
  PanelTopIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'
import type { Workspace } from '@/shared/workspace/workspace'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { cn } from '../../lib/utils'
import type { WorkspaceDisplayMode } from './WorkspaceProvider'

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  displayMode,
  setActiveWorkspaceId,
  setDisplayMode,
  onAddWorkspace,
  className,
}: {
  workspaces: readonly Workspace[]
  activeWorkspaceId: string | null
  displayMode: WorkspaceDisplayMode
  setActiveWorkspaceId: (id: string | null) => void
  setDisplayMode: (mode: WorkspaceDisplayMode) => void
  onAddWorkspace: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const search = query.trim().toLocaleLowerCase()
  const nameCounts = new Map<string, number>()
  for (const workspace of workspaces) {
    nameCounts.set(workspace.displayName, (nameCounts.get(workspace.displayName) ?? 0) + 1)
  }
  const matches = workspaces.filter((workspace) => {
    const path = workspace.rootPath ?? workspace.lastKnownPath ?? ''
    return `${workspace.displayName} ${path}`.toLocaleLowerCase().includes(search)
  })
  const close = () => {
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery('')
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            aria-label="切换工作区"
            title={activeWorkspace?.rootPath ?? activeWorkspace?.lastKnownPath}
            className={cn(
              'h-full min-w-0 flex-1 justify-start gap-2 rounded-lg px-2 text-sm font-normal hover:bg-transparent aria-expanded:bg-transparent',
              className,
            )}
          />
        }
      >
        {activeWorkspace ? (
          <FolderOpenIcon className="size-3.5 shrink-0" strokeWidth={1.5} />
        ) : (
          <FolderIcon className="size-3.5 shrink-0" strokeWidth={1.5} />
        )}
        <span className="min-w-0 flex-1 truncate text-start">
          {activeWorkspace?.displayName ?? '未分组'}
        </span>
        <ChevronDownIcon className="size-3 shrink-0 text-faint-foreground" strokeWidth={1.5} />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 gap-2 p-2">
        <div className="px-1 text-xs font-medium text-foreground">工作区</div>
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint-foreground"
            strokeWidth={1.5}
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工作区…"
            aria-label="搜索工作区"
            className="h-8 ps-8 text-xs"
          />
        </div>
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {(!search || '未分组'.includes(search)) && (
            <WorkspaceOption
              label="未分组"
              selected={activeWorkspaceId === null}
              onClick={() => {
                setActiveWorkspaceId(null)
                close()
              }}
            />
          )}
          {matches.map((workspace) => {
            const path = workspace.rootPath ?? workspace.lastKnownPath
            const showPath = (nameCounts.get(workspace.displayName) ?? 0) > 1 && path
            return (
              <WorkspaceOption
                key={workspace.id}
                label={workspace.displayName}
                path={showPath || undefined}
                selected={workspace.id === activeWorkspaceId}
                onClick={() => {
                  setActiveWorkspaceId(workspace.id)
                  close()
                }}
              />
            )
          })}
          {search && !matches.length && !'未分组'.includes(search) && (
            <p className="px-2 py-2 text-xs text-faint-foreground">没有匹配的工作区</p>
          )}
        </div>
        <div className="border-t border-border pt-2">
          <WorkspaceDisplayModeOptions
            displayMode={displayMode}
            onChange={(mode) => {
              setDisplayMode(mode)
              close()
            }}
          />
        </div>
        <div className="border-t border-border pt-1.5">
          <Button
            variant="ghost"
            className="h-8 w-full justify-start gap-2 rounded-lg px-2 text-xs font-normal"
            onClick={() => {
              close()
              onAddWorkspace()
            }}
          >
            <PlusIcon className="size-3.5" strokeWidth={1.5} />
            添加工作区
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function WorkspaceDisplayModeOptions({
  displayMode,
  onChange,
}: {
  displayMode: WorkspaceDisplayMode
  onChange: (mode: WorkspaceDisplayMode) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2 pb-1 text-xs text-faint-foreground">显示方式</p>
      <Button
        variant="ghost"
        aria-pressed={displayMode === 'single'}
        className={cn(
          'h-8 justify-start gap-2 rounded-lg px-2 text-xs font-normal',
          displayMode === 'single' && 'bg-selected text-foreground hover:bg-selected',
        )}
        onClick={() => onChange('single')}
      >
        <PanelTopIcon className="size-3.5" strokeWidth={1.5} />
        单工作区
        {displayMode === 'single' && <CheckIcon className="ms-auto size-3.5" strokeWidth={1.5} />}
      </Button>
      <Button
        variant="ghost"
        aria-pressed={displayMode === 'multiple'}
        className={cn(
          'h-8 justify-start gap-2 rounded-lg px-2 text-xs font-normal',
          displayMode === 'multiple' && 'bg-selected text-foreground hover:bg-selected',
        )}
        onClick={() => onChange('multiple')}
      >
        <ListTreeIcon className="size-3.5" strokeWidth={1.5} />
        多工作区
        {displayMode === 'multiple' && <CheckIcon className="ms-auto size-3.5" strokeWidth={1.5} />}
      </Button>
    </div>
  )
}

function WorkspaceOption({
  label,
  path,
  selected,
  onClick,
}: {
  label: string
  path?: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      className={cn(
        'h-auto min-h-9 w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-xs font-normal',
        selected && 'bg-selected text-foreground hover:bg-selected',
      )}
      title={path}
      onClick={onClick}
    >
      {selected ? (
        <FolderOpenIcon className="size-3.5 shrink-0" strokeWidth={1.5} />
      ) : (
        <FolderIcon className="size-3.5 shrink-0" strokeWidth={1.5} />
      )}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="w-full truncate">{label}</span>
        {path && <span className="w-full truncate text-[10px] text-faint-foreground">{path}</span>}
      </span>
      {selected && <CheckIcon className="size-3.5 shrink-0" strokeWidth={1.5} />}
    </Button>
  )
}
