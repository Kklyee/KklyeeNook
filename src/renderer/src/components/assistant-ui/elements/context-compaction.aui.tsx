import { useState } from 'react'
import { MessagePrimitive, useAuiState } from '@assistant-ui/react'
import { CheckIcon, LoaderCircleIcon } from 'lucide-react'
import { CommandIcon } from './command-icons'
import { MarkdownContent } from './markdown-text'
import { ToolTimeline } from './tool-timeline'

export function ContextCompactionProgress() {
  return (
    <div role="status" className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
      <span>正在调用模型整理较早的对话，保留近期消息…</span>
    </div>
  )
}

export function ContextCompactionSummary() {
  const [open, setOpen] = useState(false)
  const data = useAuiState((state) => {
    const part = state.message.content.find(
      (part) => part.type === 'data' && part.name === 'pi-compaction-summary',
    )
    return part?.type === 'data'
      ? (part.data as { summary: string; tokensBefore: number })
      : undefined
  })!
  return (
    <MessagePrimitive.Root
      data-slot="context-compaction-summary"
      className="material-panel rounded-xl px-3 py-2"
    >
      <ToolTimeline
        open={open}
        onOpenChange={setOpen}
        label={
          <>
            <CommandIcon id="compact" />
            <span className="text-foreground">上下文已整理</span>
            <CheckIcon className="size-3.5" />
          </>
        }
        trailing={
          <span className="text-xs text-muted-foreground">
            压缩前 {data.tokensBefore.toLocaleString()} tokens
          </span>
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          较早的对话已总结为以下摘要，近期消息保留。系统提示词、Skills 资源和工具定义保持独立。
        </p>
        <div className="text-sm">
          <MarkdownContent content={data.summary} />
        </div>
      </ToolTimeline>
    </MessagePrimitive.Root>
  )
}
