import { lazy, Suspense, useContext, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeftIcon, ChevronRightIcon, FolderIcon, MenuIcon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import type { RemoteConversationSnapshot, RemoteConversationSummary, RemoteEvent, RemoteProject, RemoteQueueItem, RemoteQueueMutation, RemoteState } from '@kklyeenook/shared/remote/index'
import { Button } from '@kklyeenook/ui/components/button'
import { MessageQueue } from '@kklyeenook/ui/assistant-ui/message-queue'
import { api, conversationSnapshots, loadConversation } from './api'
import { Controls, type Selection } from './Controls'
import { Approval } from './Approval'
import { Navigation, NavigationContext } from './Navigation'
import { HistorySkeleton, ListSkeleton } from './Loading'
import { Skeleton } from '@kklyeenook/ui/components/skeleton'
import { ThreadListRow } from '@kklyeenook/ui/assistant-ui/thread-list-row'

const Thread = lazy(() => import('./RemoteThread').then(module => ({ default: module.RemoteThread })))
function RemoteThread(props: React.ComponentProps<typeof Thread>) {
  return <Suspense fallback={<div className="min-h-0 flex-1 overflow-hidden px-4"><HistorySkeleton /></div>}><Thread {...props} /></Suspense>
}

function navigate(path: string) { location.hash = path }
function Header({ title, subtitle, back, create, children }: { title: string; subtitle?: string; back?: string; create?: string; children?: ReactNode }) {
  const openNavigation = useContext(NavigationContext)
  return <>
    <header className="remote-header flex shrink-0 items-center gap-2 border-b border-border py-3 pr-16 pl-3">
      {back && <Button variant="ghost" className="size-11 shrink-0" onClick={() => navigate(back)} aria-label="Back"><ArrowLeftIcon className="size-4" /></Button>}
      <div className="min-w-0 flex-1"><h1 className="truncate text-base font-semibold">{title}</h1>{subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}</div>{children}
      {create && <Button variant="ghost" className="size-11 shrink-0" onClick={() => navigate(create)} aria-label="New conversation"><PlusIcon className="size-4" /></Button>}
    </header>
    <Button variant="ghost" className="remote-menu-button size-11" onClick={openNavigation} aria-label="Open conversations"><MenuIcon /></Button>
  </>
}

export function App() {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [route, setRoute] = useState(location.hash.slice(1) || '/')
  useEffect(() => { const listener = () => setRoute(location.hash.slice(1) || '/'); addEventListener('hashchange', listener); return () => removeEventListener('hashchange', listener) }, [])
  return <NavigationContext.Provider value={() => setNavigationOpen(true)}><Route route={route} /><Navigation open={navigationOpen} onOpenChange={setNavigationOpen} route={route} /></NavigationContext.Provider>
}

function Route({ route }: { route: string }) {
  const [state, setState] = useState<RemoteState>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    api<RemoteState>('/state').then(result => { if (active) { setState(result); setError('') } }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [attempt])
  const parts = route.split('/').filter(Boolean)
  if (parts[0] !== 'projects' || !parts[1]) return <Projects />
  const projectId = parts[1]
  if (!parts[2]) return <Project key={projectId} projectId={projectId} />
  if (!state) return <div className="remote-app"><Header title="KklyeeNook" subtitle="Remote" /><div className="p-6">{error ? <><p role="alert">{error}</p><Button className="mt-4 min-h-11" onClick={() => setAttempt(attempt + 1)}><RefreshCwIcon />Retry</Button></> : <HistorySkeleton />}</div></div>
  if (parts[2] === 'new') return <NewConversation key={projectId} state={state} projectId={projectId} />
  if (parts[2] === 'conversations' && parts[3]) return <Conversation key={parts[3]} state={state} projectId={projectId} id={parts[3]} />
  return <Project key={projectId} projectId={projectId} />
}

function Projects() {
  const [projects, setProjects] = useState<RemoteProject[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = () => api<RemoteProject[]>('/projects').then(result => { if (active) { setProjects(result); setError('') } }).catch(error => { if (active) setError(error.message) })
    void refresh()
    const timer = setInterval(refresh, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  return <div className="remote-app"><Header title="KklyeeNook" subtitle="Remote" /><main className="mx-auto w-full max-w-3xl flex-1 overflow-auto px-4 py-6"><h2 className="mb-4 text-xl font-semibold tracking-tight">Projects</h2>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {!projects && !error && <ListSkeleton />}
    {projects?.length === 0 && <p className="text-sm text-muted-foreground">暂无项目</p>}
    <div className="space-y-2">{projects?.map(project => <Button key={project.id} variant="ghost" className="mobile-project-row h-auto min-h-18 w-full justify-start gap-3 rounded-2xl p-3 text-left" onClick={() => navigate(`/projects/${project.id}`)}><span className="rounded-xl bg-brand-muted p-2.5"><FolderIcon className="size-5 text-brand" /></span><span className="min-w-0 flex-1"><span className="block truncate text-base font-medium">{project.name}</span><span className="mt-1 block text-xs text-muted-foreground">{project.conversationCount} conversations{project.activeRunCount > 0 && ` · ${project.activeRunCount} running`}</span></span><ChevronRightIcon className="size-4 text-muted-foreground" /></Button>)}</div>
  </main></div>
}

function useProject(projectId: string) {
  const [project, setProject] = useState<RemoteProject>()
  useEffect(() => { let active = true; api<RemoteProject>(`/projects/${projectId}`).then(value => { if (active) setProject(value) }).catch(() => undefined); return () => { active = false } }, [projectId])
  return project
}

function Project({ projectId }: { projectId: string }) {
  const project = useProject(projectId)
  const [conversations, setConversations] = useState<RemoteConversationSummary[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = () => api<RemoteConversationSummary[]>(`/projects/${projectId}/conversations`).then(result => { if (active) { setConversations(result); setError('') } }).catch(error => { if (active) setError(error.message) })
    void refresh()
    const timer = setInterval(refresh, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [projectId])
  return <div className="remote-app"><Header title={project?.name ?? 'Project'} subtitle="Projects" back="/" create={`/projects/${projectId}/new`} /><main className="mx-auto w-full max-w-3xl flex-1 overflow-auto px-5 py-6">
    <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Conversations</h2><Button className="min-h-11 rounded-xl" onClick={() => navigate(`/projects/${projectId}/new`)}><PlusIcon className="size-4" />New</Button></div>
    {error && <p role="alert" className="mb-4 text-destructive">{error}</p>}
    {!conversations && !error && <ListSkeleton />}
    {conversations?.length === 0 && <p className="text-sm text-muted-foreground">暂无会话</p>}
    {['running', 'recent'].map(group => {
      const items = conversations?.filter(conversation => (conversation.status === 'running') === (group === 'running')) ?? []
      if (!items.length) return null
      return <section key={group} className="mb-6"><h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{group === 'running' ? 'Running' : 'Recent'}</h2><div className="space-y-0.5">{items.map(conversation => <ThreadListRow key={conversation.id} title={conversation.title} running={conversation.status === 'running'} updatedAt={conversation.updatedAt} onPointerDown={() => { void loadConversation(conversation.id).catch(() => undefined) }} onClick={() => navigate(`/projects/${projectId}/conversations/${conversation.id}`)} />)}</div></section>
    })}
  </main></div>
}

function NewConversation({ state, projectId }: { state: RemoteState; projectId: string }) {
  const project = useProject(projectId)
  const [selection, setSelection] = useState<Selection>(state.defaults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controls = <Controls state={state} selection={selection} disabled={busy} onPermission={permission => setSelection({ ...selection, permission })} onModel={model => { const available = state.models.find(item => item.provider === model.provider && item.modelId === model.modelId)!; setSelection({ ...selection, ...model, thinkingLevel: available.thinkingLevels.includes(selection.thinkingLevel) ? selection.thinkingLevel : available.thinkingLevels[0] ?? 'off' }) }} onThinking={thinkingLevel => setSelection({ ...selection, thinkingLevel })} />
  return <div className="remote-app"><Header title="New Conversation" subtitle={project?.name} back={`/projects/${projectId}`} />
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
    <RemoteThread messages={[]} running={false} busy={busy} disabled={!state.models.length} controls={controls} onSend={async (prompt, _mode, attachments) => {
      setBusy(true); setError('')
      try { const result = await api<RemoteConversationSnapshot>(`/projects/${projectId}/conversations`, 'POST', { ...selection, prompt, ...(attachments.length ? { attachments } : {}) }); conversationSnapshots.set(result.id, result); navigate(`/projects/${projectId}/conversations/${result.id}`) }
      catch (error) { setError((error as Error).message); throw error }
      finally { setBusy(false) }
    }} />
  </div>
}

function Conversation({ state, projectId, id }: { state: RemoteState; projectId: string; id: string }) {
  const project = useProject(projectId)
  const [snapshot, setSnapshot] = useState<RemoteConversationSnapshot | undefined>(() => conversationSnapshots.get(id))
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const source = new EventSource(`/api/conversations/${id}/events`)
    let seq = 0
    source.onopen = () => { if (conversationSnapshots.has(id)) { setConnected(true); setError('') } }
    source.addEventListener('remote', (message: MessageEvent) => {
      const event = JSON.parse(message.data) as RemoteEvent
      if (event.type === 'snapshot') { seq = event.seq; setSnapshot(event.snapshot); conversationSnapshots.set(id, event.snapshot); setConnected(true); setError(''); return }
      if (event.seq <= seq) return
      seq = event.seq
      if (event.type === 'error') setError(event.error)
      const current = conversationSnapshots.get(id)
      if (!current) return
      const next = ((): RemoteConversationSnapshot => {
        switch (event.type) {
          case 'message': return { ...current, messages: current.messages.some(message => message.id === event.message.id) ? current.messages.map(message => message.id === event.message.id ? event.message : message) : [...current.messages, event.message] }
          case 'activity': return { ...current, activities: event.activities }
          case 'context': return { ...current, contextUsage: event.contextUsage }
          case 'queue': return { ...current, queue: event.queue }
          case 'approvals': return { ...current, approvals: event.approvals }
          case 'status': return { ...current, status: event.status, messages: event.status === 'idle' ? current.messages.map(message => message.status === 'running' ? { ...message, status: 'complete' } : message) : current.messages }
          case 'error': return { ...current, error: event.error }
        }
      })()
      conversationSnapshots.set(id, next)
      setSnapshot(next)
    })
    source.onerror = () => { if (active) { setConnected(false); setError('Connection lost. Reconnecting…') } }
    return () => { active = false; source.close() }
  }, [id])
  const mutate = async (path: string, input?: unknown, refresh = false, send = false) => {
    const setPending = send ? setSending : setBusy
    setPending(true); setError('')
    try {
      await api(path, 'POST', input)
      if (refresh) {
        const value = await api<RemoteConversationSnapshot>(`/conversations/${id}`)
        conversationSnapshots.set(id, value)
        setSnapshot(value)
      }
      return true
    } catch (error) { setError((error as Error).message); return false }
    finally { setPending(false) }
  }
  const queueAction = (message: RemoteQueueItem, action: RemoteQueueMutation['action'], value?: string | number) => mutate(`/conversations/${id}/queue/item`, { mode: message.steer ? 'steer' : 'followUp', expected: message.expected, index: message.index, action, value })
  const running = snapshot?.status === 'running'
  const selection: Selection = { permission: snapshot?.permission ?? state.defaults.permission, provider: snapshot?.model?.provider ?? state.defaults.provider, modelId: snapshot?.model?.modelId ?? state.defaults.modelId, thinkingLevel: snapshot?.thinkingLevel ?? state.defaults.thinkingLevel }
  const modelContextWindow = state.models.find(model => model.provider === selection.provider && model.modelId === selection.modelId)?.contextWindow
  const contextUsage = snapshot?.contextUsage ?? (modelContextWindow ? { tokens: null, contextWindow: modelContextWindow, percent: null } : undefined)
  const controls = <Controls state={state} selection={selection} disabled={!connected || busy || sending || running} onPermission={permission => { void mutate(`/conversations/${id}/permission`, { permission }, true) }} onModel={model => { void mutate(`/conversations/${id}/model`, model, true) }} onThinking={thinkingLevel => { void mutate(`/conversations/${id}/thinking`, { thinkingLevel }, true) }} />
  return <div className="remote-app"><Header title={snapshot?.title ?? ''} subtitle={project?.name} back={`/projects/${projectId}`} create={`/projects/${projectId}/new`}>{!snapshot ? <Skeleton className="h-4 w-24" /> : <span aria-label={connected ? snapshot.status : 'Reconnecting'} className={`size-2 shrink-0 rounded-full ${connected ? running ? 'animate-pulse bg-brand' : 'bg-success' : 'animate-pulse bg-warning'}`} />}</Header>
    {(error || snapshot?.error) && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error || snapshot?.error}</p>}
    <RemoteThread messages={snapshot?.messages ?? []} contextUsage={contextUsage} activities={snapshot?.activities ?? []} loading={!snapshot && !error} running={running} busy={sending} disabled={!connected || !snapshot || busy} controls={controls} onSend={async (content, mode, attachments) => { if (!await mutate(`/conversations/${id}/messages`, { content, mode, ...(attachments.length ? { attachments } : {}) }, false, true)) throw new Error('Send failed') }} onStop={() => { void mutate(`/conversations/${id}/cancel`) }}>
      <MessageQueue queued={snapshot?.queue ?? []} clearing={busy || !connected} onClear={() => { void mutate(`/conversations/${id}/queue/clear`) }} onRemove={message => { void queueAction(message, 'remove') }} onSteer={message => { void queueAction(message, 'steer') }} onEdit={(message, value) => queueAction(message, 'edit', value)} onMove={(message, offset) => { void queueAction(message, 'move', message.index + offset) }} />
      {snapshot?.approvals.map(approval => <Approval key={approval.id} approval={approval} disabled={busy || !connected} onRespond={response => { void mutate(`/approvals/${approval.id}/respond`, { ...response, conversationId: id }) }} />)}
    </RemoteThread>
  </div>
}
