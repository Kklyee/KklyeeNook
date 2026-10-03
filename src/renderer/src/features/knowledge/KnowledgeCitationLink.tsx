import { useState, type ComponentProps } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { knowledgeCitationLabel, type KnowledgeReadResult } from '@/shared/knowledge/knowledge'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'

export function KnowledgeCitationLink({
  chunkId,
  children,
  ...props
}: ComponentProps<'button'> & { chunkId: string }) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<KnowledgeReadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const show = async () => {
    setOpen(true)
    setResult(null)
    setError(null)
    try {
      setResult(await window.api.knowledge.read(chunkId))
    } catch (error) {
      setError(error instanceof Error ? error.message : '来源读取失败')
    }
  }
  const openFile = async () => {
    try {
      await window.api.knowledge.open(chunkId)
    } catch (error) {
      setError(error instanceof Error ? error.message : '文件打开失败')
    }
  }
  return (
    <>
      <button
        {...props}
        type="button"
        onClick={() => void show()}
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>
            {result ? knowledgeCitationLabel(result.context.citation) : 'Knowledge 来源'}
          </DialogTitle>
          <DialogDescription className="break-all">
            {result?.context.citation.filePath ?? '读取完整章节上下文'}
          </DialogDescription>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {!result && !error && (
            <p role="status" className="text-muted-foreground text-sm">
              正在读取…
            </p>
          )}
          {result && (
            <>
              <p className="text-muted-foreground text-xs">
                {result.context.citation.sourceName}
                {result.context.citation.heading ? ` · ${result.context.citation.heading}` : ''}
              </p>
              <pre className="bg-surface-muted border border-border whitespace-pre-wrap break-words rounded-lg p-4 font-sans text-sm leading-relaxed">
                {result.context.content}
              </pre>
              {result.adjacent.map((chunk) => (
                <div key={chunk.id} className="border-t pt-3">
                  <p className="text-muted-foreground mb-2 text-xs">
                    相邻内容 · {knowledgeCitationLabel(chunk.citation)}
                  </p>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                    {chunk.content}
                  </pre>
                </div>
              ))}
              <Button variant="outline" onClick={() => void openFile()}>
                <ExternalLinkIcon />
                打开原文件
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
