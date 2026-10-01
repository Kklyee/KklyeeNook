import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReadToolResultInput, ToolExecutionResult, ToolResult } from '@/shared/tool/tool'

export interface StoredToolResult {
  runId: string
  toolCallId: string
  toolName: string
  createdAt: number
  result: ToolExecutionResult
}

export class ToolResultStore {
  constructor(private readonly directory: string) {}

  async save(runId: string, toolCallId: string, result: ToolResult): Promise<string> {
    const resultRef = `tool-result://${encodeURIComponent(runId)}/${encodeURIComponent(toolCallId)}`
    const path = this.path(resultRef)
    await mkdir(join(path, '..'), { recursive: true })
    const record: StoredToolResult = {
      runId,
      toolCallId,
      toolName: result.toolName,
      createdAt: Date.now(),
      result,
    }
    await writeFile(path, JSON.stringify(record), 'utf8')
    return resultRef
  }

  async load(resultRef: string): Promise<StoredToolResult> {
    return JSON.parse(await readFile(this.path(resultRef), 'utf8')) as StoredToolResult
  }

  async read({ resultRef, offset = 0, limit = 8 * 1024 }: ReadToolResultInput) {
    const { result } = await this.load(resultRef)
    const serialized = JSON.stringify(result)
    let end = Math.min(serialized.length, offset + limit)
    if (end < serialized.length && /[\uD800-\uDBFF]/.test(serialized[end - 1])) end += 1
    return {
      resultRef,
      offset,
      nextOffset: end,
      totalCharacters: serialized.length,
      text: serialized.slice(offset, end),
      hasMore: end < serialized.length,
    }
  }

  private path(resultRef: string): string {
    const match = /^tool-result:\/\/([^/]+)\/([^/]+)$/.exec(resultRef)
    if (!match) throw new Error('Invalid tool result reference')
    const ids = match.slice(1).map(decodeURIComponent)
    if (ids.some((id) => !id || /[\\/]/.test(id) || id.includes('\0') || id === '.' || id === '..'))
      throw new Error('Invalid tool result reference')
    return join(this.directory, encodeURIComponent(ids[0]), `${encodeURIComponent(ids[1])}.json`)
  }
}
