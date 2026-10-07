import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDownIcon, CopyIcon, SquareIcon } from 'lucide-react'
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import type { RemoteMessage } from '@kklyeenook/shared/remote/index'
import { MarkdownText } from '@kklyeenook/ui/assistant-ui/markdown-text'
import { ReasoningRoot, ReasoningTrigger, ReasoningContent } from '@kklyeenook/ui/assistant-ui/reasoning'
import { ComposerBar, ComposerSend } from '@kklyeenook/ui/assistant-ui/composer-controls'
import { StreamingMessage, StreamingText, StreamingThread } from '@kklyeenook/ui/assistant-ui/streaming-message'
import { Button } from '@kklyeenook/ui/components/button'
import { Choice } from './Controls'

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
  return <StreamingMessage><MessagePrimitive.Root className="min-w-0 py-4">
    <MessagePrimitive.Parts components={{ Text: AssistantText, Reasoning: ThinkingPart }} />
    <ActionBarPrimitive.Root className="mt-2 flex"><ActionBarPrimitive.Copy asChild><Button variant="ghost" className="min-h-11" aria-label="Copy message"><CopyIcon className="size-3.5" /></Button></ActionBarPrimitive.Copy></ActionBarPrimitive.Root>
  </MessagePrimitive.Root></StreamingMessage>
}

function ThinkingPart({ text }: { text: string }) {
  return <ReasoningRoot defaultOpen={false}><ReasoningTrigger>Thinking</ReasoningTrigger><ReasoningContent><p className="whitespace-pre-wrap text-sm text-muted-foreground">{text}</p></ReasoningContent></ReasoningRoot>
}

function AssistantText() { return <StreamingText indices={[0]}><MarkdownText /></StreamingText> }

function UserMessage() {
  return <MessagePrimitive.Root className="ml-auto my-4 max-w-[90%] rounded-2xl bg-surface-muted px-4 py-3 text-base">
    <MessagePrimitive.Parts components={{ Text: UserText }} />
  </MessagePrimitive.Root>
}

function UserText({ text }: { text: string }) { return <span className="whitespace-pre-wrap break-words">{text}</span> }

function Composer({ running, busy, disabled, controls, onSend, onStop }: {
  running: boolean
  busy: boolean
  disabled: boolean
  controls: ReactNode
  onSend(text: string, mode: 'normal' | 'followUp' | 'steer'): Promise<void>
  onStop?: () => void
}) {
  const aui = useAui()
  const draft = useAuiState(state => state.thread.composer.text)
  const [mode, setMode] = useState<'followUp' | 'steer'>('followUp')
  const submit = async (event: FormEvent, override?: 'steer') => {
    event.preventDefault()
    if (disabled || busy || !draft.trim()) return
    try {
      await onSend(draft, running ? override ?? mode : 'normal')
      aui.thread.composer().setText('')
    } catch {}
  }
  return <ComposerPrimitive.Root onSubmit={submit}><ComposerBar className="rounded-2xl p-3">
    {controls}
    <ComposerPrimitive.Input aria-label={running ? 'Ask follow-up' : 'Ask KklyeeNook'} placeholder={running ? 'Ask follow-up…' : 'Ask KklyeeNook…'} disabled={disabled || busy} autoFocus={false} submitOnEnter={false} className="my-2 max-h-40 min-h-20 w-full resize-none border-0 bg-transparent px-1 py-2 text-base outline-none" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void submit(event, event.shiftKey ? 'steer' : undefined) }} />
    <div className="flex min-h-11 items-center justify-between gap-2">
      {running ? <Choice label="Send mode" value={mode} disabled={disabled || busy} options={[{ value: 'followUp', label: 'Send after current task' }, { value: 'steer', label: 'Steer current task' }]} onChange={value => setMode(value as 'followUp' | 'steer')} /> : <span className="text-xs text-muted-foreground">{busy ? 'Sending…' : 'Remote · private connection'}</span>}
      <div className="flex items-center gap-2">{running && <Button type="button" variant="outline" className="min-h-11 px-3" disabled={disabled || busy} onClick={onStop} aria-label="Stop Agent"><SquareIcon className="size-3.5" />Stop</Button>}<ComposerSend type="submit" streaming={false} idle={!draft.trim()} className="size-11" disabled={disabled || busy || !draft.trim()} aria-label="Send message" /></div>
    </div>
  </ComposerBar></ComposerPrimitive.Root>
}

export function RemoteThread({ messages, running, busy, disabled, controls, children, onSend, onStop }: {
  messages: RemoteMessage[]
  running: boolean
  busy: boolean
  disabled: boolean
  controls: ReactNode
  children?: ReactNode
  onSend(text: string, mode: 'normal' | 'followUp' | 'steer'): Promise<void>
  onStop?: () => void
}) {
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: running,
    isDisabled: disabled,
    onNew: async message => { await onSend(message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'), running ? 'followUp' : 'normal') },
    onCancel: async () => { onStop?.() },
  })
  return <AssistantRuntimeProvider runtime={runtime}><StreamingThread><ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
    <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
      <div className="mx-auto w-full max-w-3xl">
        {!messages.length && <div className="py-10"><p className="text-lg font-medium">What would you like to work on?</p><p className="mt-2 text-sm text-muted-foreground">Your Agent runs on Desktop.</p></div>}
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        {children}
        <ThreadPrimitive.ScrollToBottom asChild><Button variant="secondary" className="mx-auto min-h-11 disabled:hidden" aria-label="Scroll to latest"><ArrowDownIcon />Latest</Button></ThreadPrimitive.ScrollToBottom>
      </div>
    </ThreadPrimitive.Viewport>
    <div className="composer-dock mx-auto w-full max-w-3xl shrink-0 px-3 pt-2"><Composer running={running} busy={busy} disabled={disabled} controls={controls} onSend={onSend} onStop={onStop} /></div>
  </ThreadPrimitive.Root></StreamingThread></AssistantRuntimeProvider>
}
