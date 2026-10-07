import { memo, type ComponentProps } from 'react'
import { TextMessagePartProvider } from '@assistant-ui/react'
import { MarkdownText as SharedMarkdownText } from '@kklyeenook/ui/assistant-ui/markdown-text'
import { KnowledgeCitationLink } from '@/renderer/src/features/knowledge/KnowledgeCitationLink'
import { cn } from '@/renderer/src/lib/utils'

const components = {
  a: ({ className, href, ...props }: ComponentProps<'a'>) => {
    const chunkId = href?.match(/^https:\/\/knowledge\.local\/chunks\/([^/?#]+)$/)?.[1]
    const linkClassName = cn('aui-md-a text-(--markdown-accent) hover:opacity-80 underline underline-offset-2', className)
    return chunkId
      ? <KnowledgeCitationLink chunkId={decodeURIComponent(chunkId)} className={linkClassName} title={props.title} id={props.id}>{props.children}</KnowledgeCitationLink>
      : <a href={href} className={linkClassName} {...props} />
  },
}

export const MarkdownText = memo(function MarkdownText(props: ComponentProps<typeof SharedMarkdownText>) {
  return <SharedMarkdownText {...props} components={{ ...components, ...props.components }} />
})

export function MarkdownContent({ content }: { content: string }) {
  return <TextMessagePartProvider text={content}><MarkdownText /></TextMessagePartProvider>
}
