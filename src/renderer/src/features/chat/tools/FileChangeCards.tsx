import { useMemo } from 'react'
import { useAui, useAuiState, type ThreadMessage } from '@assistant-ui/react'
import type { PiRuntimeExtras } from '@assistant-ui/react-pi'
import { createPatch } from 'diff'

import { usePreview, type PreviewTarget } from '@/renderer/src/features/preview/PreviewProvider'
import { normalizeToolResult } from '@/shared/tool/toolExecutionResult'
import { FileResultCard, type FileResultOperation } from './FileResultCard'
import { getStringValue, isRecord } from './toolUtils'

export function FileChangeCards() {
  const content = useAuiState((state) => state.message.content)
  const status = useAuiState((state) => state.message.status?.type)
  if (status === 'running' || status === 'requires-action') return null
  if (!content.some((part) =>
    part.type === 'tool-call' && (part.toolName === 'write' || part.toolName === 'edit'),
  ))
    return null
  return <CompletedFileChangeCards content={content} />
}

function CompletedFileChangeCards({ content }: { content: ThreadMessage['content'] }) {
  const aui = useAui()
  const { open } = usePreview()
  const files = useMemo(() => {
    const transcript =
      (aui.thread.getState().extras as PiRuntimeExtras | undefined)?.state.messages ?? []
    const results = new Map<string, unknown>()
    for (const entry of transcript) {
      if (entry.role === 'toolResult' && typeof entry.toolCallId === 'string') {
        results.set(entry.toolCallId, entry)
      }
    }
    const changes = new Map<string, { operation: FileResultOperation; target: PreviewTarget }>()
    for (const part of content) {
      if (part.type !== 'tool-call' || (part.toolName !== 'write' && part.toolName !== 'edit'))
        continue
      const raw = results.get(part.toolCallId) ?? part.result
      if (raw === undefined || part.isError || part.approval?.approved === false) continue
      const result = normalizeToolResult(raw, part.isError)
      if (result.status !== 'success') continue
      const path = getStringValue(part.args, 'path', 'file_path')
      if (!path) continue
      const details = isRecord(result.details) ? result.details : {}
      let diff =
        getStringValue(details, 'patch', 'diff') ?? getStringValue(part.args, 'patch', 'diff')
      if (part.toolName === 'edit' && !diff) {
        const oldText = getStringValue(part.args, 'oldText', 'old_text', 'old_string', 'old')
        const newText = getStringValue(part.args, 'newText', 'new_text', 'new_string', 'new')
        if (oldText !== undefined && newText !== undefined)
          diff = createPatch(path, oldText, newText)
      }
      const previous = changes.get(path)
      const operation: FileResultOperation =
        previous?.operation === 'created' || details.created === true ? 'created' : 'modified'
      changes.set(path, {
        operation,
        target: {
          kind: 'workspace-file',
          path,
          ...(part.toolName === 'edit' && diff ? { preferredView: 'diff', diff } : {}),
        },
      })
    }
    return [...changes.values()]
  }, [aui, content])

  if (!files.length) return null

  return (
    <div data-slot="file-change-cards" className="flex flex-col gap-2">
      {files.map(({ operation, target }) => (
        <FileResultCard
          key={target.path}
          path={target.path}
          operation={operation}
          onPreview={() => open(target)}
        />
      ))}
    </div>
  )
}
