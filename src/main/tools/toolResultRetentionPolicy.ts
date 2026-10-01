import type { ToolExecutionResult, ToolResult } from '@/shared/tool/tool'
import { ToolResultStore } from './toolResultStore'

export interface ToolResultRetentionPolicy {
  process(
    runId: string,
    toolCallId: string,
    result: ToolExecutionResult,
  ): Promise<ToolExecutionResult>
}

export class FileToolResultRetentionPolicy implements ToolResultRetentionPolicy {
  constructor(private readonly store: ToolResultStore) {}

  async process(
    runId: string,
    toolCallId: string,
    result: ToolExecutionResult,
  ): Promise<ToolExecutionResult> {
    const serialized = JSON.stringify(result)
    const bytes = Buffer.from(serialized, 'utf8')
    if (bytes.length <= 32 * 1024) return result
    const resultRef = await this.store.save(runId, toolCallId, result as ToolResult)
    const text =
      result.content.every((block) => block.type === 'text') &&
      Buffer.byteLength(JSON.stringify(result.content)) > 32 * 1024
        ? result.content.map((block) => block.text).join('\n')
        : serialized
    const previewBytes = Buffer.from(text, 'utf8')
    const retained: ToolExecutionResult = {
      ...result,
      content: [],
      details: undefined,
      ...(result.error
        ? { error: { ...result.error, message: result.error.message.slice(0, 1024) } }
        : {}),
      retention: { truncated: true, originalBytes: bytes.length, resultRef },
    }
    let budget = 12 * 1024
    do {
      const head = previewBytes
        .subarray(0, budget)
        .toString('utf8')
        .replace(/\uFFFD$/, '')
      const tail = previewBytes
        .subarray(Math.max(budget, previewBytes.length - budget))
        .toString('utf8')
        .replace(/^\uFFFD+/, '')
      const omitted = Math.max(0, previewBytes.length - Buffer.byteLength(head + tail))
      retained.content = [
        {
          type: 'text',
          text: `${head}\n\n... omitted ${omitted} bytes ...\n\n${tail}\n\nFull result: ${resultRef}\nUse read_tool_result with resultRef, offset and limit to read the complete result.`,
        },
      ]
      budget = Math.floor(budget / 2)
    } while (Buffer.byteLength(JSON.stringify(retained)) > 32 * 1024)
    return retained
  }
}
