'use client'

import { PermissionSelector } from './permission-selector.aui'
import { WorkspaceComposerLabel } from '@/renderer/src/features/workspaces/WorkspaceComposerLabel'

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from '@/renderer/src/components/assistant-ui/elements/attachment.aui'
import { File } from './file-preview'
import { AgentActivityGroup } from '@/renderer/src/features/chat/activity/AgentActivityGroup'
import { QueuedMessages } from '@/renderer/src/features/chat/QueuedMessages'
import { ThreadFollowupSuggestions } from '@/renderer/src/components/assistant-ui/elements/follow-up-suggestions.aui'
import { Image } from './image-preview'
import { MarkdownText } from '@/renderer/src/components/assistant-ui/elements/markdown-text'
import { StreamingMessage, StreamingText, StreamingThread } from './streaming-message'
import { ThreadScrollViewport, useScrollFollower } from './thread-scroll-follower'
import { ConversationMapAui } from './conversation-map.aui'
import {
  ComposerBar,
  ComposerContext,
  ComposerSend,
} from '@/renderer/src/components/assistant-ui/elements/composer'
import type { AgentContextUsage } from '@/shared/agent/agentContextUsage'
import {
  DEFAULT_AGENT_COMPACTION_SETTINGS,
  type AgentCompactionSettings,
} from '@/shared/agent/agentConfig'
import { calculateAgentContextBudget } from '@/shared/agent/agentContextBudget'
import {
  ModelSelectorContent,
  ModelSelectorRoot,
  ModelSelectorTrigger,
  ModelSelectorValue,
  type ModelOption,
} from '@/renderer/src/components/assistant-ui/elements/model-selector'
import { TooltipIconButton } from '@/renderer/src/components/assistant-ui/elements/tooltip-icon-button'
import { Button } from '@/renderer/src/components/ui/button'
import { Skeleton } from '@/renderer/src/components/ui/skeleton'
import { cn } from '@/renderer/src/lib/utils'
import { CommandMenu } from './command-menu.aui'
import { CommandResult } from './command-result.aui'
import { ContextCompactionProgress, ContextCompactionSummary } from './context-compaction.aui'
import { useComposerCommands } from '@/renderer/src/features/chat/commands/useComposerCommands'
import { parseSystemCommand } from '@/renderer/src/features/chat/commands/commandParser'
import { formatMessageTimestamp, formatMessageTimestampFull } from '@/shared/formatMessageTimestamp'
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  groupPartByType,
  ThreadPrimitive,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
  useAuiState,
} from '@assistant-ui/react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
} from 'lucide-react'
import {
  createContext,
  useContext,
  type ComponentType,
  type ComponentProps,
  type FC,
  type ReactNode,
  useMemo,
  memo,
} from 'react'

export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined
  Welcome?: ComponentType | undefined
  readOnly?: boolean | undefined
}

export type ThreadProps = {
  components?: ThreadComponents | undefined
  autoFocus?: boolean | undefined
  readOnly?: boolean | undefined
  modelSelector?: {
    models: readonly ModelOption[]
    value?: string
    effort?: string
    disabled?: boolean
    onValueChange: (value: string) => void
    onEffortChange: (effort: string) => void
  }
  contextUsage?: AgentContextUsage
  compactionSettings?: AgentCompactionSettings
  isCompacting?: boolean
  composerAccessory?: ReactNode
}

const EMPTY_COMPONENTS: ThreadComponents = {}

const ThreadComponentsContext = createContext<ThreadComponents>(EMPTY_COMPONENTS)

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading)

// A switched thread that is still fetching its history: skeleton, not welcome.
const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  s.thread.isLoading &&
  !s.thread.isDisabled &&
  !s.threads.isLoading

const ThreadHistorySkeleton: FC = () => (
  <div
    data-slot="aui_thread-history-skeleton"
    role="status"
    className="animate-in fade-in fill-mode-both flex flex-col gap-y-6 [animation-delay:150ms] [animation-duration:200ms]"
  >
    <span className="sr-only">Loading conversation</span>
    <Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
    </div>
    <Skeleton className="ml-auto h-9 w-1/3 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-10/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
    </div>
  </div>
)

export const Thread: FC<ThreadProps> = ({
  components = EMPTY_COMPONENTS,
  autoFocus = true,
  readOnly = false,
  modelSelector,
  contextUsage,
  compactionSettings = DEFAULT_AGENT_COMPACTION_SETTINGS,
  isCompacting = false,
  composerAccessory,
}) => {
  const isEmpty = useAuiState((state) => !readOnly && isNewChatView(state))
  const contextValue = useMemo(() => ({ ...components, readOnly }), [components, readOnly])
  const Root = readOnly ? ThreadRoot : ThreadWithCommands

  return (
    <StreamingThread>
      <ThreadComponentsContext.Provider value={contextValue}>
        <Root
          isEmpty={isEmpty}
          autoFocus={autoFocus}
          readOnly={readOnly}
          modelSelector={modelSelector}
          contextUsage={contextUsage}
          compactionSettings={compactionSettings}
          isCompacting={isCompacting}
          composerAccessory={composerAccessory}
        />
      </ThreadComponentsContext.Provider>
    </StreamingThread>
  )
}

const ThreadRoot: FC<{
  isEmpty: boolean
  autoFocus: boolean
  readOnly: boolean
  modelSelector?: ThreadProps['modelSelector']
  contextUsage?: AgentContextUsage
  compactionSettings: AgentCompactionSettings
  isCompacting: boolean
  composerAccessory?: ReactNode
  commandSurface?: ReturnType<typeof useComposerCommands>
}> = ({
  isEmpty,
  autoFocus,
  readOnly,
  modelSelector,
  contextUsage,
  compactionSettings,
  isCompacting,
  composerAccessory,
  commandSurface,
}) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext)

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root material-base @container flex h-full min-h-0 flex-col"
      style={{
        ['--thread-max-width' as string]: '44rem',
        ['--composer-bg' as string]: 'var(--color-card)',
        ['--composer-radius' as string]: '1.5rem',
        ['--composer-padding' as string]: '8px',
      }}
    >
      <ThreadScrollViewport
        turnAnchor="bottom"
        data-slot="aui_thread-viewport"
        className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [overflow-anchor:none] [scroll-behavior:auto] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ConversationMapAui />
        <div
          className={cn(
            'mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4',
            isEmpty && 'justify-center',
          )}
        >
          <AuiIf condition={(state) => !readOnly && isNewChatView(state)}>
            <Welcome />
          </AuiIf>
          <AuiIf condition={isHistoryLoadingView}>
            <ThreadHistorySkeleton />
          </AuiIf>

          <div data-slot="aui_message-group" className="mb-14 flex flex-col gap-y-6 empty:hidden">
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
            {(isCompacting || commandSurface?.result?.title === 'Compacting') && (
              <ContextCompactionProgress />
            )}
            {commandSurface?.result?.title === '/compact' && (
              <CommandResult
                result={{ ...commandSurface.result, title: '上下文整理失败' }}
                onClose={commandSurface.closeResult}
              />
            )}
          </div>

          {!readOnly && (
            <ThreadPrimitive.ViewportFooter
              className={cn(
                'aui-thread-viewport-footer material-base flex flex-col gap-4 overflow-visible pb-4 md:pb-6',
                !isEmpty && 'sticky bottom-0 mt-auto rounded-t-(--composer-radius)',
              )}
            >
              <ThreadScrollToBottom />
              <ThreadFollowupSuggestions />
              {composerAccessory}
              <Composer
                commandSurface={commandSurface!}
                autoFocus={autoFocus}
                modelSelector={modelSelector}
                contextUsage={contextUsage}
                compactionSettings={compactionSettings}
                isCompacting={isCompacting}
              />
            </ThreadPrimitive.ViewportFooter>
          )}
        </div>
      </ThreadScrollViewport>
    </ThreadPrimitive.Root>
  )
}

const ThreadWithCommands: FC<ComponentProps<typeof ThreadRoot>> = (props) => {
  const commandSurface = useComposerCommands()
  return <ThreadRoot {...props} commandSurface={commandSurface} />
}

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage, readOnly } =
    useContext(ThreadComponentsContext)
  const role = useAuiState((s) => s.message.role)
  const isEditing = useAuiState((s) => s.message.composer.isEditing)
  const isCompactionSummary = useAuiState((s) =>
    s.message.content.some((part) => part.type === 'data' && part.name === 'pi-compaction-summary'),
  )

  if (isCompactionSummary) return <ContextCompactionSummary />
  if (isEditing && !readOnly) return <EditComposer />
  if (role === 'user') return <UserMessage />
  return <AssistantMessageComponent />
}

const ThreadScrollToBottom: FC = () => {
  const { following, resume } = useScrollFollower()
  return (
    <TooltipIconButton
      tooltip="Scroll to bottom"
      variant="outline"
      disabled={following}
      onClick={resume}
      className="aui-thread-scroll-to-bottom material-control hover:border-border-strong absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
    >
      <ArrowDownIcon />
    </TooltipIconButton>
  )
}

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        开始做点什么？
      </h1>
    </div>
  )
}

const Composer: FC<{
  commandSurface: ReturnType<typeof useComposerCommands>
  autoFocus: boolean
  modelSelector?: ThreadProps['modelSelector']
  contextUsage?: AgentContextUsage
  compactionSettings: AgentCompactionSettings
  isCompacting: boolean
}> = ({
  commandSurface,
  autoFocus,
  modelSelector,
  contextUsage,
  compactionSettings,
  isCompacting,
}) => {
  const { commands, result, closeResult, submit } = commandSurface

  return (
    <div className="flex w-full flex-col gap-1.5">
      <CommandResult
        result={result && ['Compacting', '/compact'].includes(result.title) ? undefined : result}
        onClose={closeResult}
      />
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Root
          className="aui-composer-root  relative  flex w-full flex-col "
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <QueuedMessages />
          <ComposerPrimitive.AttachmentDropzone
            render={<ComposerBar data-slot="aui_composer-shell" className="composer max-w-none" />}
          >
            <ComposerAttachments />
            <ComposerPrimitive.Input
              placeholder="描述一个任务，或提出一个问题…"
              className="aui-composer-input placeholder:text-foreground/35 max-h-48 min-h-11 w-full resize-none bg-transparent px-3 py-1 text-[15px] leading-6 caret-blue-500 outline-none dark:caret-blue-400"
              rows={1}
              autoFocus={autoFocus}
              enterKeyHint="send"
              aria-label="Message input"
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter' && !event.shiftKey) {
                  const highlightedId = event.currentTarget.getAttribute('aria-activedescendant')
                  const highlighted = highlightedId ? document.getElementById(highlightedId) : null
                  if (highlighted?.dataset.commandKind === 'system') {
                    event.preventDefault()
                    void submit(false, `/${highlighted.dataset.commandId}`)
                    return
                  }
                }
                if (
                  event.key === 'Enter' &&
                  event.shiftKey &&
                  (event.ctrlKey || event.metaKey) &&
                  parseSystemCommand(event.currentTarget.value)
                ) {
                  event.preventDefault()
                  void submit(true)
                }
              }}
            />
            <ComposerAction
              onSend={() => void submit()}
              modelSelector={modelSelector}
              contextUsage={contextUsage}
              compactionSettings={compactionSettings}
              isCompacting={isCompacting}
            />
          </ComposerPrimitive.AttachmentDropzone>
          <CommandMenu commands={commands} />
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <WorkspaceComposerLabel />
    </div>
  )
}

const ComposerAction: FC<{
  onSend(): void
  modelSelector?: ThreadProps['modelSelector']
  contextUsage?: AgentContextUsage
  compactionSettings: AgentCompactionSettings
  isCompacting: boolean
}> = ({ onSend, modelSelector, contextUsage, compactionSettings, isCompacting }) => {
  const canSend = useAuiState((s) => s.composer.canSend)
  const budget = calculateAgentContextBudget(contextUsage, compactionSettings, {
    compacting: isCompacting,
  })

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <div className="flex items-center gap-1">
        <ComposerAddAttachment />
        <PermissionSelector />
        {modelSelector && modelSelector.models.length > 0 && (
          <ModelSelectorRoot
            models={modelSelector.models}
            value={modelSelector.value}
            effort={modelSelector.effort}
            onValueChange={modelSelector.onValueChange}
            onEffortChange={modelSelector.onEffortChange}
          >
            <ModelSelectorTrigger variant="ghost" size="sm" disabled={modelSelector.disabled}>
              <ModelSelectorValue placeholder="选择模型" />
            </ModelSelectorTrigger>
            <ModelSelectorContent searchable />
          </ModelSelectorRoot>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {isCompacting ? (
          <span
            data-slot="composer-context-compaction"
            aria-live="polite"
            className="text-foreground/40 whitespace-nowrap text-[11px]"
          >
            正在整理上下文…
          </span>
        ) : budget.tokens !== undefined &&
          budget.contextWindow !== undefined &&
          budget.contextWindow > 0 ? (
          <ComposerContext budget={budget} />
        ) : null}
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate
              render={
                <TooltipIconButton
                  tooltip="Voice input"
                  side="bottom"
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="aui-composer-dictate text-muted-foreground hover:text-foreground size-7 rounded-full"
                  aria-label="Start voice input"
                />
              }
            >
              <MicIcon className="aui-composer-dictate-icon size-4" />
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation
              render={
                <TooltipIconButton
                  tooltip="Stop dictation"
                  side="bottom"
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
                  aria-label="Stop voice input"
                />
              }
            >
              <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning || s.composer.canSend}>
          <ComposerPrimitive.Send
            onClick={(event) => {
              event.preventDefault()
              onSend()
            }}
            render={
              <ComposerSend
                streaming={false}
                idle={canSend}
                disabled={!canSend}
                className="aui-composer-send"
                title="发送；运行时排队，Ctrl/Cmd+Shift+Enter 调整当前任务"
              />
            }
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning && !s.composer.canSend}>
          <ComposerPrimitive.Cancel
            render={
              <Button
                type="button"
                variant="default"
                size="icon"
                className="aui-composer-cancel size-7 rounded-full bg-foreground text-black hover:bg-foreground transition-colors dark:bg-foreground"
                aria-label="Stop generating"
              />
            }
          >
            <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  )
}

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  )
}

const AssistantMessage: FC = () => {
  const { readOnly } = useContext(ThreadComponentsContext)
  const active = useAuiState((state) => state.message.isLast && state.thread.isRunning)
  const latest = useAuiState(
    (state) =>
      state.thread.messages.findLast((message) => message.role === 'assistant')?.id ===
      state.message.id,
  )

  const ACTION_BAR_PT = 'pt-1.5'
  // Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      data-streaming={active || undefined}
      className={cn(
        'relative -mb-7.5 pb-7.5',
        latest
          ? '[content-visibility:visible]'
          : '[contain-intrinsic-size:auto_200px] [content-visibility:auto]',
      )}
    >
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground flex flex-col gap-4 px-2 text-[15px] leading-relaxed wrap-break-word"
      >
        <StreamingMessage>
          <AgentActivityGroup />
          <AssistantMessageParts />
        </StreamingMessage>
        <MessageError />
      </div>

      {!readOnly && (
        <div
          data-slot="aui_assistant-message-footer"
          className={cn('ms-2 flex items-center justify-between', ACTION_BAR_HEIGHT)}
        >
          <div className="flex items-center">
            <BranchPicker />
            <AssistantActionBar />
          </div>
          <MessageTimestamp />
        </div>
      )}
    </MessagePrimitive.Root>
  )
}

const bodyParts = groupPartByType({ text: ['group-text'] })

const AssistantMessageParts = memo(function AssistantMessageParts() {
  return (
    <MessagePrimitive.GroupedParts groupBy={bodyParts} indicator="never">
      {({ part, children }) => {
        switch (part.type) {
          case 'group-text':
            return (
              <>
                <StreamingText indices={part.indices}>{children}</StreamingText>
                <AgentActivityGroup afterPartIndex={part.indices.at(-1)} />
              </>
            )
          case 'text':
            return <MarkdownText />
          case 'data':
            return part.dataRendererUI
          case 'file':
            return (
              <div data-slot="aui_assistant-message-file" className="py-1">
                <File {...part} />
              </div>
            )
          case 'image':
            return (
              <div data-slot="aui_assistant-message-image" className="py-1">
                <Image {...part} />
              </div>
            )
          default:
            return null
        }
      }}
    </MessagePrimitive.GroupedParts>
  )
})

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 opacity-55 duration-200 transition-opacity hover:opacity-100 focus-within:opacity-100"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="Copy" />}>
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload render={<TooltipIconButton tooltip="Refresh" />}>
        <RefreshCwIcon />
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger
          render={<TooltipIconButton tooltip="More" className="data-[state=open]:bg-selected" />}
        >
          <MoreHorizontalIcon />
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content material-raised data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl p-1.5"
        >
          <ActionBarPrimitive.ExportMarkdown
            render={
              <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-hover hover:text-foreground focus:bg-hover focus:text-foreground data-highlighted:bg-hover data-highlighted:text-foreground active:bg-active transition-colors flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none" />
            }
          >
            <DownloadIcon className="size-4" />
            Export as Markdown
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  )
}

const MessageTimestamp: FC = () => {
  const createdAt = useAuiState((s) => s.message.createdAt)
  const timestamp = createdAt.getTime()
  const label = formatMessageTimestamp(timestamp)
  if (!label) return null

  return (
    <time
      dateTime={createdAt.toISOString()}
      title={formatMessageTimestampFull(timestamp)}
      className="text-faint-foreground me-1 text-[11px] tabular-nums"
    >
      {label}
    </time>
  )
}

const UserFilePart: FileMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-file" className="py-1">
    <File {...part} />
  </div>
)

const UserImagePart: ImageMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-image" className="py-1">
    <Image {...part} />
  </div>
)

const UserMessage: FC = () => {
  const { readOnly } = useContext(ThreadComponentsContext)

  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts components={{ File: UserFilePart, Image: UserImagePart }} />
        </div>
        {!readOnly && (
          <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
            <UserActionBar />
          </div>
        )}
      </div>

      {!readOnly && (
        <BranchPicker
          data-slot="aui_user-branch-picker"
          className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
        />
      )}
    </MessagePrimitive.Root>
  )
}

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit
        render={<TooltipIconButton tooltip="Edit" className="aui-user-action-edit" />}
      >
        <PencilIcon />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  )
}

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg)">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel
            render={<Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5" />}
          >
            Cancel
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button size="sm" className="h-8 rounded-full px-3.5" />}>
            Update
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  )
}

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        'aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs',
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous render={<TooltipIconButton tooltip="Previous" />}>
        <ChevronLeftIcon />
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next render={<TooltipIconButton tooltip="Next" />}>
        <ChevronRightIcon />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  )
}
