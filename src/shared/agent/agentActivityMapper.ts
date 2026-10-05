import { diffLines } from 'diff'
import type { ToolCall, ToolExecutionResult } from '../tool/tool'
import {
  WEB_SEARCH_ERROR_CODES,
  type WebSearchErrorCode,
  type WebSearchSource,
} from '../web-search/webSearch'
import type { AgentActivity, ActivityStatus, ActivityTiming } from './agentActivity'

const toolTypes: Record<string, AgentActivity['type']> = {
  read: 'read',
  read_file: 'read',
  read_knowledge: 'read',
  read_tool_result: 'read',
  search: 'search',
  grep: 'search',
  search_knowledge: 'search',
  glob: 'glob',
  find: 'glob',
  edit: 'edit',
  write: 'write',
  shell: 'shell',
  bash: 'shell',
  approval: 'approval',
  web_search: 'web_search',
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function string(values: Record<string, unknown>, ...keys: string[]): string | undefined {
  return keys.map((key) => values[key]).find((value): value is string => typeof value === 'string')
}

export function mapToolCallToActivity(
  call: ToolCall,
  status: ActivityStatus,
  timing: ActivityTiming,
  result?: ToolExecutionResult,
): AgentActivity {
  const args = record(call.args)
  const metadata = record(result?.details)
  const details = record(metadata.details ?? metadata)
  const base = { id: call.id, call, result, status, ...timing }
  const type = toolTypes[call.toolName.toLowerCase()] ?? 'tool'
  const path = string(args, 'path', 'file_path', 'filePath')
  switch (type) {
    case 'read':
      return { ...base, type, path }
    case 'search':
    case 'glob': {
      const target = string(args, 'query', 'pattern')
      const text = result?.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      const lines = text
        ?.split(/\r?\n/)
        .filter((line) => line && !/^No (files|matches) found|^\[/.test(line))
      const count = details.resultCount ?? details.matchCount ?? details.fileCount
      const resultCount =
        typeof count === 'number'
          ? count
          : result
            ? lines?.filter((line) => type === 'glob' || /^.*:\d+:/.test(line)).length
            : undefined
      return type === 'search'
        ? { ...base, type, query: target, resultCount }
        : { ...base, type, pattern: target, resultCount }
    }
    case 'edit':
    case 'write': {
      const oldText = string(args, 'oldText', 'old_text', 'old_string', 'old')
      const newText = string(args, 'newText', 'new_text', 'new_string', 'new', 'content')
      let additions = typeof details.additions === 'number' ? details.additions : undefined
      let deletions = typeof details.deletions === 'number' ? details.deletions : undefined
      if (
        result?.status === 'success' &&
        newText !== undefined &&
        (oldText !== undefined || type === 'write')
      ) {
        const changes = diffLines(oldText ?? '', newText)
        additions ??= changes.reduce(
          (count, change) => count + (change.added ? change.count : 0),
          0,
        )
        deletions ??= changes.reduce(
          (count, change) => count + (change.removed ? change.count : 0),
          0,
        )
      }
      return { ...base, type, path, additions, deletions }
    }
    case 'web_search': {
      const count = details.resultCount
      return {
        ...base,
        type,
        query: string(args, 'query'),
        resultCount: typeof count === 'number' ? count : undefined,
        errorCode: webSearchErrorCode(result?.error?.message),
      }
    }
    case 'shell': {
      const code = details.exitCode ?? details.exit_code
      return {
        ...base,
        type,
        command: string(args, 'command'),
        exitCode: typeof code === 'number' ? code : undefined,
      }
    }
    case 'approval':
      return { ...base, type, label: string(args, 'label') }
    default:
      return { ...base, type: 'tool', toolName: call.toolName }
  }
}

function webSearchErrorCode(message: string | undefined): WebSearchErrorCode | undefined {
  return WEB_SEARCH_ERROR_CODES.find((code) => message?.includes(code))
}

export function webSearchSources(result?: ToolExecutionResult): WebSearchSource[] {
  const sources = record(result?.details).sources
  return Array.isArray(sources) ? (sources as WebSearchSource[]) : []
}
