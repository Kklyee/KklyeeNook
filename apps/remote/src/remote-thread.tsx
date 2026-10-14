import { useMemo, useRef, useState, useLayoutEffect, type FormEvent, type ReactNode, type ComponentProps } from 'react'
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
import type {
  RemoteActivity,
  RemoteContextBudget,
  RemoteFileAttachment,
  RemoteMessage,
  RemoteQueueItem,
  RemoteSendMessageInput,
} from '@kklyeenook/shared/remote/index'
import { MarkdownText } from '@kklyeenook/ui/assistant-ui/markdown-text'
import { ImageThumbnail } from '@kklyeenook/ui/assistant-ui/image-thumbnail'
import { ComposerBar, ComposerSend } from '@kklyeenook/ui/assistant-ui/composer-controls'
import { SessionStats } from '@kklyeenook/ui/assistant-ui/session-stats'
import { ComposerContext } from '@kklyeenook/ui/assistant-ui/composer-context'
import {
  StreamingMessage,
  StreamingText,
  StreamingThread,
} from '@kklyeenook/ui/assistant-ui/streaming-message'
import { Button } from '@kklyeenook/ui/components/button'
import { Choice } from './Controls'
import { ActivityContext, InlineActivity } from './Activity'
import { HistorySkeleton } from './Loading'
import {
  ComposerAddAttachment,
  ComposerAttachments,
} from '@kklyeenook/ui/assistant-ui/attachment.aui'
import { remoteAttachmentAdapter, serializeAttachments } from './attachments'
import { ApiError } from './api'
import { scrollPositions } from '@kklyeenook/ui/assistant-ui/scroll-position'
import { ExecutionProcess, MessageModel, FileChanges } from './message-details'

const convertMessage = (message: RemoteMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.role,
  content: message.content.map((part, index) => part.type === 'text' && message.execution?.finalPartIndex !== undefined && index >= message.execution.finalPartIndex ? { ...part, parentId: 'final' } : part),
  metadata: { custom: { execution: message.execution, stepCount: message.stepCount, model: message.model, fileChanges: message.fileChanges, pendingSteer: message.pendingSteer } },
  createdAt: new Date(message.timestamp),
  ...(message.role === 'assistant'
    ? {
        status:
          message.status === 'running'
            ? { type: 'running' }
            : message.status === 'failed'
              ? { type: 'incomplete', reason: 'error' }
              : message.status === 'cancelled'
                ? { type: 'incomplete', reason: 'cancelled' }
                : { type: 'complete', reason: 'stop' },
      }
    : {}),
})

function AssistantMessage() {
  const answered = useAuiState((state) =>
    state.message.content.some((part) => part.type === 'text' && part.text.trim()),
  )
  return (
    <StreamingMessage>
      <MessagePrimitive.Root className="min-w-0 py-4">
        <AssistantParts />
        <FileChanges />
        {answered && (
          <ActionBarPrimitive.Root hideWhenRunning className="mt-2 flex items-center">
            <ActionBarPrimitive.Copy asChild>
              <Button variant="ghost" className="min-h-11" aria-label="Copy message"><CopyIcon className="size-3.5" /></Button>
            </ActionBarPrimitive.Copy>
            <MessageModel />
          </ActionBarPrimitive.Root>
        )}
      </MessagePrimitive.Root>
    </StreamingMessage>
  )
}

function AssistantParts() {
  const execution = useAuiState((state) => state.message.metadata.custom?.execution as RemoteMessage['execution'])
  const partCount = useAuiState((state) => state.message.content.length)
  const groupBy = useMemo<ComponentProps<typeof MessagePrimitive.GroupedParts>['groupBy']>(() => (part, context) => {
    const path = bodyParts(part, context) ?? []
    return !execution || (part.type === 'text' && part.parentId === 'final') ? path : ['group-process', ...path]
  }, [!!execution])
  return (<>
        {execution && (partCount === 0 || execution.finalPartIndex === 0) && <ExecutionProcess />}
        {!execution && <InlineActivity />}
        <MessagePrimitive.GroupedParts groupBy={groupBy} indicator="never">
          {({ part, children }) => {
            if (part.type === 'group-process') return <ExecutionProcess>{children}</ExecutionProcess>
            if (part.type === 'group-text')
              return (
                <>
                  <StreamingText indices={part.indices}>{children}</StreamingText>
                  {(!execution || (part.indices.at(-1) ?? 0) < (execution.finalPartIndex ?? Infinity)) && <InlineActivity afterPartIndex={part.indices.at(-1)} />}
                </>
              )
            if (part.type === 'text') return <MarkdownText />
            if (part.type === 'image') return <ImageThumbnail {...part} />
            return null
          }}
        </MessagePrimitive.GroupedParts>
    </>
  )
}
const bodyParts = groupPartByType({ text: ['group-text'] })
const messageComponents = { UserMessage, AssistantMessage }

function UserMessage() {
  return (
    <MessagePrimitive.Root className="ml-auto my-4 max-w-[90%] rounded-2xl bg-surface-muted px-4 py-3 text-base">
      <MessagePrimitive.Parts components={{ Text: UserText, Image: UserImage }} />
      <PendingSteer />
    </MessagePrimitive.Root>
  )
}

function PendingSteer() {
  const pending = useAuiState((state) => state.message.metadata.custom?.pendingSteer)
  return pending ? <p className="mt-1 text-xs text-muted-foreground">引导已接收，等待当前步骤结束后生效</p> : null
}

function UserImage(props: React.ComponentProps<typeof ImageThumbnail>) {
  return <div className="block py-1"><ImageThumbnail {...props} /></div>
}

function UserText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current!
    const measure = () => setLong(element.scrollHeight > 256)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])
  return <div>
    <div className={long && !expanded ? 'max-h-64 overflow-hidden' : undefined}><div ref={ref} className="whitespace-pre-wrap break-words">{text}</div></div>
    {long && <Button variant="ghost" className="mt-1 px-0 text-xs" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开全文'}</Button>}
  </div>
}

function Composer({
  running,
  busy,
  disabled,
  controls,
  onStop,
  botName,
  queue,
}: {
  botName?: string
  queue?: ReactNode
  running: boolean
  busy: boolean
  disabled: boolean
  controls: ReactNode
  onStop?: () => void
}) {
  const aui = useAui()
  const canSend = useAuiState((state) => state.thread.composer.canSend)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  useAuiEvent('composer.attachmentAddError', ({ message }) => setError(message))
  const [mode, setMode] = useState<'followUp' | 'steer'>('followUp')
  const submit = async (event: FormEvent, override?: 'steer') => {
    event.preventDefault()
    if (disabled || busy || preparing || !canSend) return
    setPreparing(true)
    setError('')
    try {
      await aui.thread.composer().send({ steer: running && (override ?? mode) === 'steer' })
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setPreparing(false)
    }
  }
  const cancel = running
  return (
    <ComposerPrimitive.Root className="aui-composer-root" onSubmit={submit}>
      {queue}
      <ComposerBar className="mobile-composer rounded-3xl p-3">
        <ComposerAttachments showNames />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <ComposerPrimitive.Input
          aria-label={running ? 'Ask follow-up' : 'Ask KklyeeNook'}
          placeholder={
            running
              ? mode === 'steer'
                ? 'Steer the current run…'
                : 'Send after the current task…'
              : botName
                ? `发送消息给 ${botName}…`
                : 'Ask KklyeeNook…'
          }
          disabled={disabled || busy}
          autoFocus={false}
          submitOnEnter={false}
          className="max-h-36 min-h-14 w-full resize-none border-0 bg-transparent px-1 py-2 text-base outline-none"
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter')
              void submit(event, event.shiftKey ? 'steer' : undefined)
          }}
        />
        <div className="flex min-h-11 items-center gap-1.5">
          {controls}
          {running && (
            <div className="flex shrink-0 items-center rounded-full bg-brand-muted text-brand">
              <Button
                type="submit"
                variant="ghost"
                className="min-h-11 rounded-l-full rounded-r-none px-2 text-xs text-brand"
                disabled={disabled || busy || preparing || !canSend}
                aria-label={mode === 'steer' ? 'Steer current task' : 'Queue follow-up'}
              >
                {mode === 'steer' ? 'Steer' : 'Queue'}
              </Button>
              <Choice
                menuOnly
                label="Send mode"
                value={mode}
                disabled={disabled || busy || preparing}
                options={[
                  { value: 'followUp', label: 'Queue' },
                  { value: 'steer', label: 'Steer' },
                ]}
                onChange={(value) => setMode(value as 'followUp' | 'steer')}
              />
            </div>
          )}
          <ComposerAddAttachment
            disabled={disabled || busy || preparing}
            className="size-11 shrink-0"
          />
          <ComposerSend
            pending={busy || preparing}
            type={cancel ? 'button' : 'submit'}
            onClick={cancel ? onStop : undefined}
            streaming={cancel}
            idle={!canSend}
            className="size-11 shrink-0 disabled:opacity-40"
            disabled={disabled || busy || preparing || (!canSend && !running)}
            aria-label={
              busy || preparing ? 'Sending message' : cancel ? 'Stop Agent' : 'Send message'
            }
          />
        </div>
      </ComposerBar>
    </ComposerPrimitive.Root>
  )
}

export function RemoteThread({
  messages: transcript,
  contextBudget,
  activities = [],
  loading = false,
  running,
  busy,
  disabled,
  controls,
  children,
  onSend,
  onStop,
  botName,
  botKind,
  queue,
  pendingSteer = [],
  conversationId,
}: {
  botName?: string
  botKind?: 'coding' | 'personal'
  queue?: ReactNode
  pendingSteer?: RemoteQueueItem[]
  conversationId?: string
  messages: RemoteMessage[]
  contextBudget?: RemoteContextBudget
  activities?: RemoteActivity[]
  loading?: boolean
  running: boolean
  busy: boolean
  disabled: boolean
  controls: ReactNode
  children?: ReactNode
  onSend(
    text: string,
    mode: 'normal' | 'followUp' | 'steer',
    attachments: RemoteFileAttachment[],
    requestId: string,
  ): Promise<void>
  onStop?: () => void
}) {
  const [sendError, setSendError] = useState('')
  const viewport = useRef<HTMLDivElement>(null)
  const positioned = useRef(false)
  const savedPosition = conversationId ? scrollPositions.get(conversationId) : undefined
  const [following, setFollowing] = useState(savedPosition?.following ?? true)
  useLayoutEffect(() => {
    if (loading || positioned.current || !viewport.current) return
    viewport.current.scrollTop = savedPosition && !savedPosition.following ? savedPosition.top : viewport.current.scrollHeight
    positioned.current = true
  }, [loading, transcript.length])
  useLayoutEffect(() => {
    const element = viewport.current
    return () => {
      if (conversationId && positioned.current && element) scrollPositions.set(conversationId, { top: element.scrollTop, following: element.scrollHeight - element.clientHeight - element.scrollTop <= 1 })
    }
  }, [conversationId])
  const pending = useRef<
    | {
        fingerprint: string
        input: RemoteSendMessageInput & { requestId: string; attachments: RemoteFileAttachment[] }
      }
    | undefined
  >(undefined)
  const messages = useMemo(() => {
    const result = [...transcript]
    const steer = pendingSteer.map((item): RemoteMessage => ({ id: `queued-steer:${item.id}`, role: 'user', timestamp: 0, content: [{ type: 'text', text: item.text }], pendingSteer: true }))
    result.splice(running && result.at(-1)?.role === 'assistant' ? result.length - 1 : result.length, 0, ...steer)
    const last = result.at(-1)
    if (running && last?.role === 'assistant')
      result[result.length - 1] = { ...last, status: 'running' }
    return result
  }, [transcript, running, pendingSteer])
  const lastMessage = messages.at(-1)
  const statsReady = !running && !busy && !loading && !sendError &&
    lastMessage?.role === 'assistant' && lastMessage.status === 'complete' &&
    lastMessage.content.some((part) => part.type === 'text' && part.text.trim().length > 0)
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: running,
    isDisabled: disabled,
    isLoading: loading,
    adapters: { attachments: remoteAttachmentAdapter },
    onNew: async (message) => {
      setSendError('')
      let attachments: RemoteFileAttachment[]
      try {
        attachments = serializeAttachments(message.attachments ?? [])
      } catch (error) {
        setSendError((error as Error).message)
        throw error
      }
      const content = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      const fingerprint = JSON.stringify({ content, attachments })
      const admission =
        pending.current?.fingerprint === fingerprint
          ? pending.current
          : {
              fingerprint,
              input: {
                content,
                attachments,
                mode: message.steer ? ('steer' as const) : ('followUp' as const),
                requestId: crypto.randomUUID(),
              },
            }
      pending.current = admission
      try {
        await onSend(
          admission.input.content,
          admission.input.mode,
          admission.input.attachments,
          admission.input.requestId,
        )
        if (pending.current === admission) pending.current = undefined
      } catch (error) {
        setSendError((error as Error).message)
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          pending.current === admission
        )
          pending.current = undefined
        throw error
      }
    },
    onCancel: async () => {
      onStop?.()
    },
  })
  return (
    <ActivityContext.Provider value={{ activities, messages }}>
      <AssistantRuntimeProvider runtime={runtime}>
        <StreamingThread>
          <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col">
            {loading && <div className="absolute inset-0 overflow-hidden px-5"><div className="mx-auto w-full max-w-3xl"><HistorySkeleton /></div></div>}
            <ThreadPrimitive.Viewport ref={viewport} autoScroll={following} onScroll={(event) => {
              if (!positioned.current) return
              const element = event.currentTarget
              const following = element.scrollHeight - element.clientHeight - element.scrollTop <= 1
              setFollowing(following)
              if (conversationId) scrollPositions.set(conversationId, { top: element.scrollTop, following })
            }} scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false} aria-busy={loading} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${loading ? 'invisible' : ''}`}>

              <div className="mx-auto w-full max-w-3xl">
                {!loading && !messages.length && botName && (
                  <div className="py-10 text-center">
                    <h2 className="text-xl font-medium">
                      {botKind === 'coding' ? '一起开始开发吧' : '今天想做些什么？'}
                    </h2>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      {(botKind === 'coding'
                        ? ['介绍当前项目的结构', '检查构建和测试', '帮我解释一段代码']
                        : ['帮我整理今天的计划', '帮我拆解一个目标', '帮我研究一个问题']
                      ).map((prompt) => (
                        <ThreadPrimitive.Suggestion
                          key={prompt}
                          prompt={prompt}
                          method="replace"
                          className="min-h-11 rounded-full border border-border px-3 text-xs text-muted-foreground hover:bg-hover"
                        >
                          {prompt}
                        </ThreadPrimitive.Suggestion>
                      ))}
                    </div>
                  </div>
                )}
                <ThreadPrimitive.Messages components={messageComponents} />
                {children}
                <ThreadPrimitive.ScrollToBottom asChild>
                  <Button
                    variant="secondary"
                    className="mx-auto min-h-11 bg-surface-opaque hover:bg-surface-opaque disabled:hidden"
                    aria-label="Scroll to latest"
                  >
                    <ArrowDownIcon />
                    Latest
                  </Button>
                </ThreadPrimitive.ScrollToBottom>
              </div>
            </ThreadPrimitive.Viewport>
            </div>
            <div className="composer-dock mx-auto w-full max-w-3xl shrink-0 px-3 pt-2">
              {sendError && (
                <p role="alert" className="mb-2 text-xs text-destructive">
                  {sendError}
                </p>
              )}
              <Composer
                running={running}
                busy={busy}
                disabled={disabled}
                controls={controls}
                onStop={onStop}
                botName={botName}
                queue={queue}
              />
              <div data-slot="remote-session-stats" className="h-7">
              <SessionStats
                messages={transcript}
                ready={statsReady}
                compact
              >
                {contextBudget && <ComposerContext budget={contextBudget} className="shrink-0" />}
              </SessionStats>
              </div>
            </div>
          </ThreadPrimitive.Root>
        </StreamingThread>
      </AssistantRuntimeProvider>
    </ActivityContext.Provider>
  )
}
