import { useMemo } from 'react'
import { CodeDiff, type DiffLine } from './CodeDiff'

export function DiffPreview({ diff, filename }: { diff: string; filename: string }) {
  const lines = useMemo<DiffLine[]>(() => {
    const occurrences = new Map<string, number>()
    return diff.split('\n').map((line) => {
      const occurrence = occurrences.get(line) ?? 0
      occurrences.set(line, occurrence + 1)
      const id = `${line}:${occurrence}`
      const match = line.match(/^(?:\d+\s*)?([+\-−])(.*)$/)
      if (match && !line.startsWith('+++') && !line.startsWith('---')) {
        return { id, kind: match[1] === '+' ? 'added' : 'removed', text: match[2]! }
      }
      return { id, kind: 'context', text: line }
    })
  }, [diff])
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <CodeDiff
        filename={filename}
        lines={lines}
        additions={lines.filter((line) => line.kind === 'added').length}
        deletions={lines.filter((line) => line.kind === 'removed').length}
        className="max-w-none"
      />
    </div>
  )
}
