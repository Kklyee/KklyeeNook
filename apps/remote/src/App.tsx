import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeftIcon, ChevronRightIcon, FolderIcon, Loader2Icon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import type { RemoteConversationSnapshot, RemoteConversationSummary, RemoteEvent, RemoteProject, RemoteQueueItem, RemoteQueueMutation, RemoteState } from '@kklyeenook/shared/remote/index'
import { Button } from '@kklyeenook/ui/components/button'
import { MessageQueue } from '@kklyeenook/ui/assistant-ui/message-queue'
import { api } from './api'
import { Controls, type Selection } from './Controls'
import { Activity } from './Activity'
import { Approval } from './Approval'

const Thread = lazy(() => import('./RemoteThread').then(module => ({ default: module.RemoteThread })))
function RemoteThread(props: React.ComponentProps<typeof Thread>) {
  return <Suspense fallback={<div className="flex-1 animate-pulse bg-surface-muted" aria-label="Loading conversation" />}><Thread {...props} /></Suspense>
}

function navigate(path: string) { location.hash = path }
function Header({ title, subtitle, back, children }: { title: string; subtitle?: string; back?: string; children?: ReactNode }) {
  return <header className="remote-header flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
    {back && <Button variant="ghost" className="min-h-11 min-w-11" onClick={() => navigate(back)} aria-label="Back"><ArrowLeftIcon /></Button>}
    <div className="min-w-0 flex-1"><h1 className="truncate text-base font-semibold">{title}</h1>{subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}</div>{children}
  </header>
}

export function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || '/')
  const [state, setState] = useState<RemoteState>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { const listener = () => setRoute(location.hash.slice(1) || '/'); addEventListener('hashchange', listener); return () => removeEventListener('hashchange', listener) }, [])
  useEffect(() => {
    let active = true
    api<RemoteState>('/state').then(result => { if (active) { setState(result); setError('') } }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [attempt])
  const parts = route.split('/').filter(Boolean)
  if (parts[0] !== 'projects' || !parts[1]) return <Projects />
  const projectId = parts[1]
  if (!parts[2]) return <Project key={projectId} projectId={projectId} />
  if (!state) return <div className="remote-app"><Header title="KklyeeNook" subtitle="Remote" /><div className="p-6">{error ? <><p role="alert">{error}</p><Button className="mt-4 min-h-11" onClick={() => setAttempt(attempt + 1)}><RefreshCwIcon />Retry</Button></> : <div className="h-32 animate-pulse rounded-2xl bg-surface-muted" aria-label="Loading conversation" />}</div></div>
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
  return <div className="remote-app"><Header title="KklyeeNook" subtitle="Remote" /><main className="mx-auto w-full max-w-3xl flex-1 overflow-auto px-5 py-8"><h2 className="mb-5 text-2xl font-semibold tracking-tight">Projects</h2>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {!projects && !error && <p role="status" className="text-sm text-muted-foreground">Loading projects…</p>}
    {projects?.length === 0 && <p className="text-sm text-muted-foreground">Attach a project in Desktop to get started.</p>}
    <div className="space-y-3">{projects?.map(project => <Button key={project.id} variant="ghost" className="material-control h-auto min-h-24 w-full justify-start gap-4 rounded-2xl p-4 text-left" onClick={() => navigate(`/projects/${project.id}`)}><span className="rounded-xl bg-brand-muted p-3"><FolderIcon className="size-5 text-brand" /></span><span className="min-w-0 flex-1"><span className="block truncate text-base font-medium">{project.name}</span><span className="mt-1 block text-xs text-muted-foreground">{project.conversationCount} conversations{project.activeRunCount > 0 && ` · ${project.activeRunCount} running`}</span></span><ChevronRightIcon className="size-4 text-muted-foreground" /></Button>)}</div>
    <p className="mt-8 text-xs leading-relaxed text-muted-foreground">Keep Desktop running. Add KklyeeNook to your home screen from your browser menu.</p>
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
  return <div className="remote-app"><Header title={project?.name ?? 'Project'} subtitle="Projects" back="/" /><main className="mx-auto w-full max-w-3xl flex-1 overflow-auto px-5 py-6">
    <Button className="mb-7 min-h-12 w-full rounded-xl" onClick={() => navigate(`/projects/${projectId}/new`)}><PlusIcon />New Conversation</Button>
    {error && <p role="alert" className="mb-4 text-destructive">{error}</p>}
    {!conversations && !error && <p role="status" className="text-muted-foreground">Loading conversations…</p>}
    {conversations?.length === 0 && <p className="text-sm text-muted-foreground">Start the first conversation in this project.</p>}
    {['running', 'recent'].map(group => {
      const items = conversations?.filter(conversation => (conversation.status === 'running') === (group === 'running')) ?? []
      if (!items.length) return null
      return <section key={group} className="mb-6"><h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{group === 'running' ? 'Running' : 'Recent'}</h2><div className="space-y-2">{items.map(conversation => <Button key={conversation.id} variant="ghost" className="material-control h-auto min-h-16 w-full justify-start rounded-xl px-4 py-3 text-left" onClick={() => navigate(`/projects/${projectId}/conversations/${conversation.id}`)}>{conversation.status === 'running' && <Loader2Icon className="size-4 shrink-0 animate-spin text-brand" />}<span className="min-w-0 flex-1 truncate">{conversation.title}</span><ChevronRightIcon className="size-4 text-muted-foreground" /></Button>)}</div></section>
    })}
  </main></div>
}

function NewConversation({ state, projectId }: { state: RemoteState; projectId: string }) {
  const project = useProject(projectId)
  const [selection, setSelection] = useState<Selection>(state.defaults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controls = <Controls state={state} selection={selection} disabled={busy} onPermission={permission => setSelection({ ...selection, permission })} onModel={model => { const available = state.models.find(item => item.provider === model.provider && item.modelId === model.modelId)!; setSelection({ ...selection, ...model, thinkingLevel: available.thinkingLevels.includes(selection.thinkingLevel) ? selection.thinkingLevel : available.thinkingLevels[0] ?? 'off' }) }} onThinking={thinkingLevel => setSelection({ ...selection, thinkingLevel })} />
  return <div className="remote-app"><Header title="New Conversation" subtitle={`Project · ${project?.name ?? 'Loading…'}`} back={`/projects/${projectId}`} />
    {error && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error}</p>}
    <RemoteThread messages={[]} running={false} busy={busy} disabled={!state.models.length} controls={controls} onSend={async prompt => {
      setBusy(true); setError('')
      try { const result = await api<RemoteConversationSnapshot>(`/projects/${projectId}/conversations`, 'POST', { ...selection, prompt }); navigate(`/projects/${projectId}/conversations/${result.id}`) }
      catch (error) { setError((error as Error).message); throw error }
      finally { setBusy(false) }
    }} />
  </div>
}

function Conversation({ state, projectId, id }: { state: RemoteState; projectId: string; id: string }) {
  const project = useProject(projectId)
  const [snapshot, setSnapshot] = useState<RemoteConversationSnapshot>()
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const source = new EventSource(`/api/conversations/${id}/events`)
    let seq = 0
    source.addEventListener('remote', (message: MessageEvent) => {
      const event = JSON.parse(message.data) as RemoteEvent
      if (event.type === 'snapshot') { seq = event.seq; setSnapshot(event.snapshot); setConnected(true); setError(''); return }
      if (event.seq <= seq) return
      seq = event.seq
      setSnapshot(current => {
        if (!current) return current
        switch (event.type) {
          case 'message': return { ...current, messages: current.messages.some(message => message.id === event.message.id) ? current.messages.map(message => message.id === event.message.id ? event.message : message) : [...current.messages, event.message] }
          case 'activity': return { ...current, activities: event.activities }
          case 'queue': return { ...current, queue: event.queue }
          case 'approvals': return { ...current, approvals: event.approvals }
          case 'status': return { ...current, status: event.status, messages: event.status === 'idle' ? current.messages.map(message => message.status === 'running' ? { ...message, status: 'complete' } : message) : current.messages }
          case 'error': return { ...current, error: event.error }
        }
      })
    })
    source.onerror = () => { setConnected(false); void api(`/conversations/${id}`).catch(error => setError(error.message)) }
    return () => source.close()
  }, [id])
  const mutate = async (path: string, input?: unknown, refresh = false) => {
    setBusy(true); setError('')
    try {
      await api(path, 'POST', input)
      if (refresh) setSnapshot(await api<RemoteConversationSnapshot>(`/conversations/${id}`))
      return true
    } catch (error) { setError((error as Error).message); return false }
    finally { setBusy(false) }
  }
  const queueAction = (message: RemoteQueueItem, action: RemoteQueueMutation['action'], value?: string | number) => mutate(`/conversations/${id}/queue/item`, { mode: message.steer ? 'steer' : 'followUp', expected: message.expected, index: message.index, action, value })
  const running = snapshot?.status === 'running'
  const selection: Selection = { permission: snapshot?.permission ?? state.defaults.permission, provider: snapshot?.model?.provider ?? state.defaults.provider, modelId: snapshot?.model?.modelId ?? state.defaults.modelId, thinkingLevel: snapshot?.thinkingLevel ?? state.defaults.thinkingLevel }
  const controls = <Controls state={state} selection={selection} disabled={!connected || busy || running} onPermission={permission => { void mutate(`/conversations/${id}/permission`, { permission }, true) }} onModel={model => { void mutate(`/conversations/${id}/model`, model, true) }} onThinking={thinkingLevel => { void mutate(`/conversations/${id}/thinking`, { thinkingLevel }, true) }} />
  return <div className="remote-app"><Header title={snapshot?.title ?? 'Conversation'} subtitle={`Project · ${project?.name ?? 'Loading…'}`} back={`/projects/${projectId}`}><span className={`shrink-0 text-xs ${running ? 'text-brand' : 'text-muted-foreground'}`}>{snapshot?.status ?? 'Loading'}</span></Header>
    {!connected && <p role="status" className="bg-warning-muted px-4 py-2 text-xs">{snapshot ? 'Connection lost. Reconnecting… Agent continues on Desktop.' : 'Connecting to conversation…'}</p>}
    {(error || snapshot?.error) && <p role="alert" className="px-4 py-2 text-sm text-destructive">{error || snapshot?.error}</p>}
    <RemoteThread messages={snapshot?.messages ?? []} running={running} busy={busy} disabled={!connected} controls={controls} onSend={async (content, mode) => { if (!await mutate(`/conversations/${id}/messages`, { content, mode })) throw new Error('Send failed') }} onStop={() => { void mutate(`/conversations/${id}/cancel`) }}>
      <Activity activities={snapshot?.activities ?? []} />
      <MessageQueue queued={snapshot?.queue ?? []} clearing={busy || !connected} onClear={() => { void mutate(`/conversations/${id}/queue/clear`) }} onRemove={message => { void queueAction(message, 'remove') }} onSteer={message => { void queueAction(message, 'steer') }} onEdit={(message, value) => queueAction(message, 'edit', value)} onMove={(message, offset) => { void queueAction(message, 'move', message.index + offset) }} />
      {snapshot?.approvals.map(approval => <Approval key={approval.id} approval={approval} disabled={busy || !connected} onRespond={response => { void mutate(`/approvals/${approval.id}/respond`, { ...response, conversationId: id }) }} />)}
    </RemoteThread>
  </div>
}
