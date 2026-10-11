import type { ToolCallMessagePartComponent } from '@assistant-ui/react'

import { ToolCard } from '@/renderer/src/components/assistant-ui/elements/tool-call'
import { usePreview } from '@/renderer/src/features/preview/PreviewProvider'
import { formatToolResult, getStringValue, isRecord } from '../toolUtils'

type SearchResult =
  | { path: string; line?: never; snippet?: never }
  | { path: string; line: number; snippet: string }

export const SearchToolRenderer: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  status,
}) => {
  const { open } = usePreview()
  const values = isRecord(args) ? args : {}
  const isGlob = toolName === 'find'
  const pattern = getStringValue(values, 'pattern') ?? ''
  const text = formatToolResult(result)
  const results = parseSearchResults(text, isGlob)
  const details = isRecord(result) && isRecord(result.details) ? result.details : {}
  const limited = isGlob ? details.resultLimitReached : details.matchLimitReached
  const truncated = isRecord(details.truncation) && details.truncation.truncated === true
  const resultCount = `${results.length}${limited || truncated ? '+' : ''}`
  const error = status.type === 'incomplete' ? getErrorText(status.error, result) : undefined

  return (
    <ToolCard
      toolName={toolName}
      label={isGlob ? 'Find files' : 'Search'}
      summary={pattern}
      resultCount={resultCount}
      status={status}
    >
      {status.type === 'incomplete' ? (
        <p className="whitespace-pre-wrap break-words text-danger">{error || 'Search failed'}</p>
      ) : results.length ? (
        <div className="max-h-72 overflow-auto">
          {results.map((item, index) => {
            const path = resolveResultPath(getStringValue(values, 'path'), item.path)
            return (
              <button
                key={`${item.path}:${item.line ?? index}`}
                type="button"
                className="flex w-full min-w-0 items-baseline gap-x-1 rounded-sm px-1 text-left font-mono text-[11px] leading-5 hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                onClick={() =>
                  open({
                    kind: 'workspace-file',
                    path,
                    ...(item.line === undefined ? {} : { line: item.line }),
                  })
                }
              >
                {item.line === undefined ? (
                  <span className="min-w-0 break-words text-muted-foreground">{item.path}</span>
                ) : (
                  <>
                    <span className="shrink-0 text-muted-foreground">{item.path}:</span>
                    <span className="shrink-0 text-faint-foreground">{item.line}</span>
                    <span className="min-w-0 whitespace-pre-wrap break-words text-foreground">
                      {item.snippet}
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>
      ) : status.type === 'running' ? (
        <p className="text-faint-foreground">{isGlob ? 'Finding files…' : 'Searching…'}</p>
      ) : status.type === 'requires-action' ? (
        <p className="text-faint-foreground">Waiting for permission…</p>
      ) : (
        <p className="text-faint-foreground">{isGlob ? 'No files found' : 'No matches found'}</p>
      )}
    </ToolCard>
  )
}

function parseSearchResults(text: string, isGlob: boolean): SearchResult[] {
  return text.split(/\r?\n/).flatMap((line) => {
    if (
      !line ||
      /^\[[^\]]*(?:limit reached|lines truncated)/i.test(line) ||
      /^No (files|matches) found/.test(line)
    )
      return []
    if (isGlob) return [{ path: line.replace(/^\.\//, '') }]
    const match = line.match(/^(.*):(\d+): (.*)$/)
    return match ? [{ path: match[1]!, line: Number(match[2]), snippet: match[3]! }] : []
  })
}

function resolveResultPath(searchPath: string | undefined, resultPath: string): string {
  const result = resultPath.replaceAll('\\', '/').replace(/^\.\//, '')
  if (result.startsWith('/') || /^[a-z]:\//i.test(result)) return result
  const base = (searchPath ?? '').replaceAll('\\', '/').replace(/\/$/, '')
  if (!base || base === '.') return result
  if (base.split('/').at(-1) === result && !searchPath?.endsWith('/') && !searchPath?.endsWith('\\')) {
    return base
  }
  return `${base}/${result}`.replace(/^\.\//, '')
}

function getErrorText(error: unknown, result: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (isRecord(error) && typeof error.message === 'string') return error.message
  if (isRecord(result) && isRecord(result.error) && typeof result.error.message === 'string') {
    return result.error.message
  }
  return formatToolResult(result)
}
