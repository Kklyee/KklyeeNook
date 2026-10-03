import { useEffect, useMemo, useRef, useState } from 'react'

export function CodeFilePreview({ content }: { content: string }) {
  return <CodeFileContent key={content} content={content} />
}

function CodeFileContent({ content }: { content: string }) {
  const lines = useMemo(() => content.split('\n'), [content])
  const container = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(600)
  const [scrollTop, setScrollTop] = useState(0)
  const scrollHeight = Math.min(30_000_000, lines.length * 20 + 24)
  const logicalTop =
    (scrollTop * Math.max(0, lines.length * 20 + 24 - height)) / Math.max(1, scrollHeight - height)
  const start = Math.max(0, Math.floor(logicalTop / 20) - 10)
  const end = Math.min(lines.length, start + Math.ceil(height / 20) + 20)
  const longestLine = useMemo(
    () =>
      lines.reduce((longest, line) => Math.max(longest, line.replaceAll('\t', '    ').length), 0),
    [lines],
  )
  useEffect(() => {
    const observer = new ResizeObserver((entries) => setHeight(entries[0]!.contentRect.height))
    observer.observe(container.current!)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={container}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="min-h-0 flex-1 overflow-auto"
      aria-label="文件源码"
    >
      <div
        className="relative min-w-full font-mono text-xs leading-5"
        style={{ height: scrollHeight, width: `calc(${longestLine}ch + 6rem)` }}
      >
        {lines.slice(start, end).map((line, index) => (
          <div
            key={start + index}
            className="absolute flex w-max min-w-full"
            style={{ top: scrollTop + (start + index) * 20 - logicalTop + 12 }}
          >
            <span
              aria-hidden="true"
              className="text-muted-foreground/60 sticky left-0 w-16 shrink-0 bg-background px-3 text-right select-none"
            >
              {start + index + 1}
            </span>
            <span className="px-3 whitespace-pre" style={{ tabSize: 4 }}>
              {line || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
