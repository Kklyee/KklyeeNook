import { createContext, useEffect, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, PlusIcon, SearchIcon } from 'lucide-react'
import type { RemoteConversationSummary, RemoteProject } from '@kklyeenook/shared/remote/index'
import { Dialog, DialogContent, DialogTitle } from '@kklyeenook/ui/components/dialog'
import { Button } from '@kklyeenook/ui/components/button'
import { Input } from '@kklyeenook/ui/components/input'
import { api } from './api'
import { ListSkeleton } from './Loading'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@kklyeenook/ui/components/collapsible'
import { ThreadListRow } from '@kklyeenook/ui/assistant-ui/thread-list-row'

export const NavigationContext = createContext<() => void>(() => undefined)

export function Navigation({ open, onOpenChange, route }: { open: boolean; onOpenChange(open: boolean): void; route: string }) {
  const [projects, setProjects] = useState<RemoteProject[]>()
  const [conversations, setConversations] = useState<Record<string, RemoteConversationSummary[]>>({})
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    api<RemoteProject[]>('/projects').then(async projects => {
      if (!active) return
      setProjects(projects); setError('')
      await Promise.all(projects.map(async project => {
        const items = await api<RemoteConversationSummary[]>(`/projects/${project.id}/conversations`)
        if (active) setConversations(current => ({ ...current, [project.id]: items }))
      }))
    }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [open])
  const select = (path: string) => { location.hash = path; onOpenChange(false) }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent initialFocus={false} className="mobile-navigation top-0 left-0 translate-x-0 translate-y-0" showCloseButton={false}>
    <DialogTitle className="text-lg">KklyeeNook</DialogTitle>
    <label className="relative"><SearchIcon className="absolute top-3.5 left-3 size-4 text-muted-foreground" /><Input aria-label="Search conversations" placeholder="Search conversations" value={search} onChange={event => setSearch(event.target.value)} className="min-h-11 rounded-xl pl-9" /></label>
    <nav className="min-h-0 flex-1 overflow-y-auto py-2" aria-label="Projects and conversations">
      {error && <p role="alert" className="px-2 py-3 text-sm text-destructive">{error}</p>}
      {!projects && <ListSkeleton />}
      {projects?.map(project => {
        const items = conversations[project.id]?.filter(item => `${item.title} ${project.name}`.toLowerCase().includes(search.toLowerCase()))
        if (search && items?.length === 0 && !project.name.toLowerCase().includes(search.toLowerCase())) return null
        return <ProjectConversations key={project.id} project={project} items={items} route={route} search={search} first={project.id === projects[0].id} select={select} />
      })}
    </nav>
    <Button variant="ghost" className="min-h-11 justify-start border-t border-border pt-3" onClick={() => select('/')}><FolderIcon className="size-4" />All projects</Button>
  </DialogContent></Dialog>
}

function ProjectConversations({ project, items, route, search, first, select }: { project: RemoteProject; items?: RemoteConversationSummary[]; route: string; search: string; first: boolean; select(path: string): void }) {
  const active = route.startsWith(`/projects/${project.id}`)
  const [open, setOpen] = useState(active || first)
  const [expanded, setExpanded] = useState(false)
  const visible = expanded || search ? items : items?.slice(0, 5)
  const opened = !!search || open
  const Chevron = opened ? ChevronDownIcon : ChevronRightIcon
  const Folder = opened ? FolderOpenIcon : FolderIcon
  return <Collapsible open={opened} onOpenChange={setOpen} className="mb-3 flex flex-col gap-0.5">
    <div className={`sidebar-row flex min-h-11 items-center gap-0.5 rounded-lg pr-1 text-muted-foreground hover:bg-hover ${active ? 'bg-selected text-foreground' : ''}`}>
      <CollapsibleTrigger render={<Button variant="ghost" className="min-h-11 min-w-0 flex-1 justify-start gap-2 rounded-lg px-2 text-sm font-normal hover:bg-transparent" />}><span className="flex shrink-0 items-center gap-1.5"><Chevron className="size-3" strokeWidth={1.5} /><Folder className={`size-3.5 ${opened ? 'stroke-brand' : ''}`} strokeWidth={1.5} /></span><span className="truncate">{project.name}</span></CollapsibleTrigger>
      <Button variant="ghost" className="size-9 shrink-0 rounded-lg p-0 text-faint-foreground" aria-label={`New conversation in ${project.name}`} onClick={() => select(`/projects/${project.id}/new`)}><PlusIcon className="size-3.5" strokeWidth={1.5} /></Button>
    </div>
    <CollapsibleContent className="flex flex-col gap-0.5">
      {!items && <ListSkeleton />}
      {visible?.map(item => { const path = `/projects/${project.id}/conversations/${item.id}`; return <ThreadListRow key={item.id} title={item.title} active={route === path} running={item.status === 'running'} updatedAt={item.updatedAt} onClick={() => select(path)} /> })}
      {!search && items && items.length > 5 && <Button variant="ghost" className="min-h-11 justify-start pl-8 text-xs font-normal text-faint-foreground" onClick={() => setExpanded(!expanded)}>{expanded ? '收起会话' : `展开其余 ${items.length - 5} 个会话`}</Button>}
    </CollapsibleContent>
  </Collapsible>
}
