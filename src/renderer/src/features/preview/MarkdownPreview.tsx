import { useState } from 'react'
import { Button } from '@/renderer/src/components/ui/button'
import { MarkdownContent } from '@/renderer/src/components/assistant-ui/elements/markdown-text'
import { CodeFilePreview } from './CodeFilePreview'

export function MarkdownPreview({ content }: { content: string }) {
  const [source, setSource] = useState(false)
  return (
    <>
      <nav
        aria-label="Markdown 视图"
        className="border-border/60 flex shrink-0 gap-1 border-b px-3 py-2"
      >
        <Button
          size="sm"
          variant={source ? 'ghost' : 'secondary'}
          aria-pressed={!source}
          onClick={() => setSource(false)}
        >
          预览
        </Button>
        <Button
          size="sm"
          variant={source ? 'secondary' : 'ghost'}
          aria-pressed={source}
          onClick={() => setSource(true)}
        >
          源码
        </Button>
      </nav>
      {source ? (
        <CodeFilePreview content={content} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-5 text-sm">
          <MarkdownContent content={content} />
        </div>
      )}
    </>
  )
}
