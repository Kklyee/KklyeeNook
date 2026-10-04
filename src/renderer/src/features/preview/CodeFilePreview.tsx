import { useEffect, useMemo, useRef, useState } from 'react'
import { useShikiHighlighter } from 'react-shiki'
import { codeHighlightOptions, codeHighlightTheme } from '@/renderer/src/components/assistant-ui/elements/shiki-highlighter'

type CodeFilePreviewProps = { content: string; focusLine?: number; language?: string }

export function CodeFilePreview({ content, focusLine, language = 'text' }: CodeFilePreviewProps) {
  return <CodeFileContent key={content} content={content} focusLine={focusLine} language={language} />
}

function CodeFileContent({ content, focusLine, language = 'text' }: CodeFilePreviewProps) {
  const lines = useMemo(() => content.split('\n'), [content])
  const highlighted = useShikiHighlighter(content, language, codeHighlightTheme, {
    ...codeHighlightOptions,
    outputFormat: 'tokens',
  })
  const container = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(600)
  const [scrollTop, setScrollTop] = useState(0)
  const scrollHeight = Math.min(30_000_000, lines.length * 20 + 24)
  const logicalTop =
    (scrollTop * Math.max(0, lines.length * 20 + 24 - height)) / Math.max(1, scrollHeight - height)
  const start = Math.max(0, Math.floor(logicalTop / 20) - 10)
  const end = Math.min(lines.length, start + Math.ceil(height / 20) + 20)
  useEffect(() => {
    if (focusLine === undefined || !container.current) return
    const fullHeight = lines.length * 20 + 24
    const logicalTop = Math.min(
      Math.max(0, (Math.min(focusLine, lines.length) - 1) * 20 - height / 3),
      Math.max(0, fullHeight - height),
    )
    const nextTop =
      fullHeight <= height
        ? 0
        : (logicalTop * Math.max(0, scrollHeight - height)) / (fullHeight - height)
    container.current.scrollTop = nextTop
    setScrollTop(nextTop)
  }, [focusLine, height, lines.length, scrollHeight])
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
            className={`absolute flex w-max min-w-full ${focusLine === start + index + 1 ? 'bg-hover' : ''}`}
            style={{ top: scrollTop + (start + index) * 20 - logicalTop + 12 }}
          >
            <span
              aria-hidden="true"
              className="text-muted-foreground/60 sticky left-0 w-16 shrink-0 bg-background px-3 text-right select-none"
            >
              {start + index + 1}
            </span>
            <span className="px-3 whitespace-pre" style={{ tabSize: 4 }}>
              {highlighted?.tokens[start + index]?.map((token, tokenIndex) => (
                <span key={tokenIndex} style={token.htmlStyle}>{token.content}</span>
              )) ?? (line || ' ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
