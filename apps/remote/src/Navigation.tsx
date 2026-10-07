import { createContext, useEffect, useState } from 'react'
import { FolderIcon, Loader2Icon, PlusIcon, SearchIcon } from 'lucide-react'
import type { RemoteConversationSummary, RemoteProject } from '@kklyeenook/shared/remote/index'
import { Dialog, DialogContent, DialogTitle } from '@kklyeenook/ui/components/dialog'
import { Button } from '@kklyeenook/ui/components/button'
import { Input } from '@kklyeenook/ui/components/input'
import { api } from './api'
import { ListSkeleton } from './Loading'

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
  const activeProject = route.split('/')[2] ?? projects?.[0]?.id
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="mobile-navigation top-0 left-0 translate-x-0 translate-y-0" showCloseButton={false}>
    <div className="flex items-center justify-between gap-3"><DialogTitle className="text-lg">KklyeeNook</DialogTitle><Button className="min-h-11 rounded-xl" disabled={!activeProject} onClick={() => select(`/projects/${activeProject}/new`)}><PlusIcon className="size-4" />New</Button></div>
    <label className="relative"><SearchIcon className="absolute top-3.5 left-3 size-4 text-muted-foreground" /><Input aria-label="Search conversations" placeholder="Search conversations" value={search} onChange={event => setSearch(event.target.value)} className="min-h-11 rounded-xl pl-9" /></label>
    <nav className="min-h-0 flex-1 overflow-y-auto py-2" aria-label="Projects and conversations">
      {error && <p role="alert" className="px-2 py-3 text-sm text-destructive">{error}</p>}
      {!projects && <ListSkeleton />}
      {projects?.map(project => {
        const items = conversations[project.id]?.filter(item => `${item.title} ${project.name}`.toLowerCase().includes(search.toLowerCase()))
        if (search && items?.length === 0 && !project.name.toLowerCase().includes(search.toLowerCase())) return null
        return <section key={project.id} className="mb-5"><Button variant="ghost" className="min-h-11 w-full justify-start gap-2 text-muted-foreground" onClick={() => select(`/projects/${project.id}`)}><FolderIcon className="size-4" /><span className="truncate">{project.name}</span>{project.activeRunCount > 0 && <span className="ml-auto size-2 rounded-full bg-brand" />}</Button>
          {!items && <ListSkeleton />}
          {items?.map(item => { const path = `/projects/${project.id}/conversations/${item.id}`; return <Button key={item.id} variant="ghost" data-active={route === path} className="mobile-conversation-link min-h-12 w-full justify-start rounded-xl px-3 text-left" onClick={() => select(path)}><span className="min-w-0 flex-1 truncate">{item.title}</span>{item.status === 'running' && <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />}</Button> })}
          {items?.length === 0 && !search && <p className="px-3 py-2 text-xs text-muted-foreground">No conversations yet</p>}
        </section>
      })}
    </nav>
    <Button variant="ghost" className="min-h-11 justify-start border-t border-border pt-3" onClick={() => select('/')}><FolderIcon className="size-4" />All projects</Button>
  </DialogContent></Dialog>
}
