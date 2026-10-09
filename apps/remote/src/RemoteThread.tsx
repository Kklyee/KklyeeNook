import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDownIcon, CopyIcon } from 'lucide-react'
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useAuiEvent,
  useExternalStoreRuntime,
  groupPartByType,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import type { RemoteActivity, RemoteContextUsage, RemoteFileAttachment, RemoteMessage } from '@kklyeenook/shared/remote/index'
import { MarkdownText } from '@kklyeenook/ui/assistant-ui/markdown-text'
import { ImageThumbnail } from '@kklyeenook/ui/assistant-ui/image-thumbnail'
import { ComposerBar, ComposerSend } from '@kklyeenook/ui/assistant-ui/composer-controls'
import { SessionStats } from '@kklyeenook/ui/assistant-ui/session-stats'
import { StreamingMessage, StreamingText, StreamingThread } from '@kklyeenook/ui/assistant-ui/streaming-message'
import { Button } from '@kklyeenook/ui/components/button'
import { Choice } from './Controls'
import { ActivityContext, InlineActivity } from './Activity'
import { HistorySkeleton } from './Loading'
import { ComposerAddAttachment, ComposerAttachments } from '@kklyeenook/ui/assistant-ui/attachment.aui'
import { remoteAttachmentAdapter, serializeAttachments } from './attachments'

const convertMessage = (message: RemoteMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: new Date(message.timestamp),
  ...(message.role === 'assistant' ? {
    status: message.status === 'running' ? { type: 'running' } : message.status === 'failed' ? { type: 'incomplete', reason: 'error' } : message.status === 'cancelled' ? { type: 'incomplete', reason: 'cancelled' } : { type: 'complete', reason: 'stop' },
  } : {}),
})

function AssistantMessage() {
  const answered = useAuiState(state => state.message.content.some(part => part.type === 'text' && part.text.trim()))
  return <StreamingMessage><MessagePrimitive.Root className="min-w-0 py-4">
    <InlineActivity />
    <MessagePrimitive.GroupedParts groupBy={bodyParts} indicator="never">{({ part, children }) => {
      if (part.type === 'group-text') return <><StreamingText indices={part.indices}>{children}</StreamingText><InlineActivity afterPartIndex={part.indices.at(-1)} /></>
      if (part.type === 'text') return <MarkdownText />
      if (part.type === 'image') return children
      return null
    }}</MessagePrimitive.GroupedParts>
    {answered && <ActionBarPrimitive.Root hideWhenRunning className="mt-2 flex"><ActionBarPrimitive.Copy asChild><Button variant="ghost" className="min-h-11" aria-label="Copy message"><CopyIcon className="size-3.5" /></Button></ActionBarPrimitive.Copy></ActionBarPrimitive.Root>}
  </MessagePrimitive.Root></StreamingMessage>
}
const bodyParts = groupPartByType({ text: ['group-text'] })
const messageComponents = { UserMessage, AssistantMessage }

function UserMessage() {
  return <MessagePrimitive.Root className="ml-auto my-4 max-w-[90%] rounded-2xl bg-surface-muted px-4 py-3 text-base">
    <MessagePrimitive.Parts components={{ Text: UserText, Image: ImageThumbnail }} />
  </MessagePrimitive.Root>
}

function UserText({ text }: { text: string }) { return <span className="whitespace-pre-wrap break-words">{text}</span> }

function Composer({ running, busy, disabled, controls, onStop }: {
  running: boolean
  busy: boolean
  disabled: boolean
  controls: ReactNode
  onStop?: () => void
}) {
  const aui = useAui()
  const canSend = useAuiState(state => state.thread.composer.canSend)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  useAuiEvent('composer.attachmentAddError', ({ message }) => setError(message))
  const [mode, setMode] = useState<'followUp' | 'steer'>('steer')
  const submit = async (event: FormEvent, override?: 'steer') => {
    event.preventDefault()
    if (disabled || busy || preparing || !canSend) return
    setPreparing(true); setError('')
    try {
      await aui.thread.composer().send({ steer: running && (override ?? mode) === 'steer' })
    } catch (error) { setError((error as Error).message) }
    finally { setPreparing(false) }
  }
  const cancel = running
  return <ComposerPrimitive.Root onSubmit={submit}><ComposerBar className="mobile-composer rounded-3xl p-3">
    <ComposerAttachments showNames />
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <ComposerPrimitive.Input aria-label={running ? 'Ask follow-up' : 'Ask KklyeeNook'} placeholder={running ? mode === 'steer' ? 'Steer the current run…' : 'Send after the current task…' : 'Ask KklyeeNook…'} disabled={disabled || busy} autoFocus={false} submitOnEnter={false} className="max-h-36 min-h-14 w-full resize-none border-0 bg-transparent px-1 py-2 text-base outline-none" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void submit(event, event.shiftKey ? 'steer' : undefined) }} />
    <div className="flex min-h-11 items-center gap-1.5">
      {controls}
      {running && <div className="flex shrink-0 items-center rounded-full bg-brand-muted text-brand"><Button type="submit" variant="ghost" className="min-h-11 rounded-l-full rounded-r-none px-2 text-xs text-brand" disabled={disabled || busy || preparing || !canSend} aria-label={mode === 'steer' ? 'Steer current task' : 'Queue follow-up'}>{mode === 'steer' ? 'Steer' : 'Queue'}</Button><Choice menuOnly label="Send mode" value={mode} disabled={disabled || busy || preparing} options={[{ value: 'followUp', label: 'Queue' }, { value: 'steer', label: 'Steer' }]} onChange={value => setMode(value as 'followUp' | 'steer')} /></div>}
      <ComposerAddAttachment disabled={disabled || busy || preparing} className="size-11 shrink-0" />
      <ComposerSend pending={busy || preparing} type={cancel ? 'button' : 'submit'} onClick={cancel ? onStop : undefined} streaming={cancel} idle={!canSend} className="size-11 shrink-0 disabled:opacity-40" disabled={disabled || busy || preparing || (!canSend && !running)} aria-label={busy || preparing ? 'Sending message' : cancel ? 'Stop Agent' : 'Send message'} />
    </div>
  </ComposerBar></ComposerPrimitive.Root>
}

export function RemoteThread({ messages: transcript, contextUsage, activities = [], loading = false, running, busy, disabled, controls, children, onSend, onStop }: {
  messages: RemoteMessage[]
  contextUsage?: RemoteContextUsage
  activities?: RemoteActivity[]
  loading?: boolean
  running: boolean
  busy: boolean
  disabled: boolean
  controls: ReactNode
  children?: ReactNode
  onSend(text: string, mode: 'normal' | 'followUp' | 'steer', attachments: RemoteFileAttachment[]): Promise<void>
  onStop?: () => void
}) {
  const [sendError, setSendError] = useState('')
  const messages = useMemo(() => {
    const result: RemoteMessage[] = []
    for (const message of transcript) {
      const previous = result.at(-1)
      if (message.role === 'assistant' && previous?.role === 'assistant') result[result.length - 1] = { ...previous, content: [...previous.content, ...message.content], status: message.status }
      else result.push(message)
    }
    const last = result.at(-1)
    if (running && last?.role === 'assistant') result[result.length - 1] = { ...last, status: 'running' }
    return result
  }, [transcript, running])
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: running,
    isDisabled: disabled,
    isLoading: loading,
    adapters: { attachments: remoteAttachmentAdapter },
    onNew: async message => {
      setSendError('')
      let attachments: RemoteFileAttachment[]
      try { attachments = serializeAttachments(message.attachments ?? []) }
      catch (error) { setSendError((error as Error).message); throw error }
      await onSend(message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'), running ? message.steer ? 'steer' : 'followUp' : 'normal', attachments)
    },
    onCancel: async () => { onStop?.() },
  })
  return <ActivityContext.Provider value={{ activities, messages }}><AssistantRuntimeProvider runtime={runtime}><StreamingThread><ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
    <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="mx-auto w-full max-w-3xl">
        {loading && <HistorySkeleton />}
        <ThreadPrimitive.Messages components={messageComponents} />
        {children}
        <ThreadPrimitive.ScrollToBottom asChild><Button variant="secondary" className="mx-auto min-h-11 disabled:hidden" aria-label="Scroll to latest"><ArrowDownIcon />Latest</Button></ThreadPrimitive.ScrollToBottom>
      </div>
    </ThreadPrimitive.Viewport>
    <div className="composer-dock mx-auto w-full max-w-3xl shrink-0 px-3 pt-2">{sendError && <p role="alert" className="mb-2 text-xs text-destructive">{sendError}</p>}<Composer running={running} busy={busy} disabled={disabled} controls={controls} onStop={onStop} /><SessionStats messages={transcript} contextUsage={contextUsage} showContext compact /></div>
  </ThreadPrimitive.Root></StreamingThread></AssistantRuntimeProvider></ActivityContext.Provider>
}
