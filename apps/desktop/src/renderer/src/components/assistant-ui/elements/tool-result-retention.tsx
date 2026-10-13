import { useEffect, useMemo, useRef, useState } from 'react'
import type { ToolExecutionResult } from '@kklyeenook/shared/tool/tool'
import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { toolCodeClassName } from './tool-call'

export function ToolResultRetention({ result }: { result?: ToolExecutionResult }) {
  const [open, setOpen] = useState(false)
  const [fullResult, setFullResult] = useState<ToolExecutionResult>()
  const [error, setError] = useState<string>()
  const version = useRef(0)
  useEffect(() => () => { version.current++ }, [])
  const previewBytes = useMemo(() => result?.retention?.truncated ? new TextEncoder().encode(JSON.stringify(result)).length : 0, [result])
  const fullText = useMemo(() => fullResult ? JSON.stringify(fullResult, null, 2) : undefined, [fullResult])
  const close = (next: boolean) => {
    setOpen(next)
    if (!next) {
      version.current++
      setFullResult(undefined)
      setError(undefined)
    }
  }
  const retention = result?.retention
  if (!retention?.truncated || !retention.resultRef) return null
  const formatSize = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`
  const loadResult = async () => {
    const request = ++version.current
    setFullResult(undefined)
    setOpen(true)
    setError(undefined)
    try {
      const value = await window.api.readToolResult(retention.resultRef!)
      if (request === version.current) setFullResult(value)
    } catch (error) {
      if (request === version.current) setError(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-xs">
      <span>
        结果已裁剪
        {retention.originalBytes === undefined
          ? ''
          : ` · ${formatSize(retention.originalBytes)} → ${formatSize(previewBytes)} 预览`}
      </span>
      <Button variant="link" size="sm" onClick={loadResult}>
        查看完整结果
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>完整工具结果</DialogTitle>
            <DialogDescription>{retention.resultRef}</DialogDescription>
          </DialogHeader>
          <pre className={`${toolCodeClassName} max-h-[70vh] overflow-auto`}>
            {error ?? (fullText ?? '加载中…')}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
