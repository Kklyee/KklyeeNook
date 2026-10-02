import { useEffect, useState } from 'react'
import { Button } from '@/renderer/src/components/ui/button'
import { formatFileSize } from '@/renderer/src/components/assistant-ui/elements/file-preview'
import type { WorkspaceFilePreview as FilePreview } from '@/shared/preview/workspacePreview'
import { CodeFilePreview } from './CodeFilePreview'
import { MarkdownPreview } from './MarkdownPreview'
import { ImageFilePreview } from './ImageFilePreview'
import { DiffPreview } from './DiffPreview'
import { usePreview, type PreviewTarget } from './PreviewProvider'

export function WorkspaceFilePreview({
  target,
}: {
  target: Extract<PreviewTarget, { kind: 'workspace-file' }>
}) {
  const { sessionId, revision, close } = usePreview()
  const [file, setFile] = useState<FilePreview>()
  const [error, setError] = useState<string>()
  const [view, setView] = useState(target.diff && target.preferredView === 'diff' ? 'diff' : 'file')

  useEffect(() => {
    setView(target.diff && target.preferredView === 'diff' ? 'diff' : 'file')
  }, [target])

  useEffect(() => {
    let active = true
    setError(undefined)
    if (!sessionId) {
      setError('会话工作区不可用')
      return
    }
    void window.api.preview.readWorkspaceFile({ sessionId, path: target.path }).then(
      (result) => {
        if (active) setFile(result)
      },
      (failure) => {
        if (active) setError(failure instanceof Error ? failure.message : '无法读取文件')
      },
    )
    return () => {
      active = false
    }
  }, [sessionId, target.path, revision, view])

  let content
  if (view === 'diff' && target.diff) {
    content = (
      <DiffPreview diff={target.diff} filename={target.path.split(/[\\/]/).pop() ?? target.path} />
    )
  } else if (error || file?.kind === 'missing' || file?.kind === 'unsupported') {
    content = (
      <div
        role="status"
        className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm"
      >
        <p>
          {error ??
            (file?.kind === 'missing'
              ? '文件不存在，可能已被移动或删除。'
              : file?.kind === 'unsupported' && file.reason === 'too-large'
                ? '文件过大，无法预览'
                : '暂不支持预览此文件格式')}
        </p>
        {file?.kind === 'unsupported' && <p className="text-xs">{formatFileSize(file.size)}</p>}
        <Button variant="ghost" size="sm" onClick={close}>
          关闭
        </Button>
      </div>
    )
  } else if (file?.kind === 'text') {
    content = /\.(md|markdown)$/i.test(file.filename) ? (
      <MarkdownPreview content={file.content} />
    ) : (
      <CodeFilePreview content={file.content} />
    )
  } else if (file?.kind === 'image') {
    content = <ImageFilePreview {...file} />
  } else {
    content = (
      <div role="status" className="text-muted-foreground p-6 text-sm">
        正在读取文件…
      </div>
    )
  }

  return (
    <>
      {target.diff && (
        <nav
          aria-label="文件视图"
          className="border-border/60 flex shrink-0 gap-1 border-b px-3 py-2"
        >
          <Button
            size="sm"
            variant={view === 'file' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'file'}
            onClick={() => setView('file')}
          >
            文件
          </Button>
          <Button
            size="sm"
            variant={view === 'diff' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'diff'}
            onClick={() => setView('diff')}
          >
            更改
          </Button>
        </nav>
      )}
      {content}
    </>
  )
}
