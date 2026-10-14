import { createPatch, parsePatch } from 'diff'
import type { ToolExecutionResult } from '@kklyeenook/shared/tool/tool'
import { normalizeToolResult } from '@kklyeenook/shared/tool/toolExecutionResult'

export interface AgentFileChange {
  path: string
  operation: 'created' | 'modified'
  additions?: number
  deletions?: number
  diff?: string
}

export interface AgentFileChangeInput {
  toolName: string
  args: unknown
  result?: unknown
  isError?: boolean
  approvalRejected?: boolean
}

const FILE_TOOLS = new Set(['write', 'edit'])

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function text(values: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof values[key] === 'string') return values[key]
  }
  return undefined
}

function patchStats(diff: string): { additions: number; deletions: number } | undefined {
  let patches
  try {
    patches = parsePatch(diff)
  } catch {
    return undefined
  }
  if (!patches.length) return undefined
  let additions = 0
  let deletions = 0
  let hunks = 0
  for (const patch of patches) {
    for (const hunk of patch.hunks) {
      hunks += 1
      for (const line of hunk.lines) {
        if (line.startsWith('+')) additions += 1
        if (line.startsWith('-')) deletions += 1
      }
    }
  }
  return hunks ? { additions, deletions } : undefined
}

function diffFor(
  toolName: string,
  args: Record<string, unknown>,
  operation: AgentFileChange['operation'],
  path: string,
): string | undefined {
  const oldText = text(args, 'oldText', 'old_text', 'old_string', 'old')
  const newText = text(args, 'newText', 'new_text', 'new_string', 'new', 'content')
  if (toolName === 'edit' && oldText !== undefined && newText !== undefined)
    return createPatch(path, oldText, newText)
  if (toolName === 'write' && operation === 'created' && newText !== undefined)
    return createPatch(path, '', newText)
  return undefined
}

/** File writes and edits a message performed, in first-change order. */
export function collectAgentFileChanges(
  inputs: readonly AgentFileChangeInput[],
): AgentFileChange[] {
  const changes = new Map<string, AgentFileChange>()
  for (const input of inputs) {
    if (!FILE_TOOLS.has(input.toolName) || input.isError || input.approvalRejected) continue
    const args = record(input.args)
    const path = text(args, 'path', 'file_path', 'filePath')
    if (!path) continue
    const result = normalizeToolResult(input.result, input.isError)
    if (result.status !== 'success') continue
    const details = record(result.details)
    const previous = changes.get(path)
    const operation: AgentFileChange['operation'] =
      previous?.operation === 'created' || details.created === true ? 'created' : 'modified'
    const provided = text(details, 'patch', 'diff') ?? text(args, 'patch', 'diff')
    const reconstructed = diffFor(input.toolName, args, operation, path)
    const diff =
      provided && patchStats(provided) ? provided : (reconstructed ?? provided)
    const stats = diff ? patchStats(diff) : undefined
    const tracked = previous?.additions !== undefined || stats !== undefined
    changes.set(path, {
      path,
      operation,
      ...(tracked
        ? {
            additions: (previous?.additions ?? 0) + (stats?.additions ?? 0),
            deletions: (previous?.deletions ?? 0) + (stats?.deletions ?? 0),
          }
        : {}),
      ...(operation === 'modified' && diff ? { diff } : {}),
    })
  }
  return [...changes.values()]
}

export function isFileChangeTool(toolName: string): boolean {
  return FILE_TOOLS.has(toolName)
}

export type { ToolExecutionResult }
