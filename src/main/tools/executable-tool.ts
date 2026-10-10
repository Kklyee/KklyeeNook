import type { Static, TSchema } from 'typebox'
import type { ToolExecutionResult } from '@/shared/tool/tool'

export type ToolUpdateHandler = (partial: unknown) => void

export interface ExecutableToolContext {}

export interface ExecutableTool<TParameters extends TSchema = TSchema, TDetails = unknown> {
  name: string
  label: string
  description: string
  parameters: TParameters
  outputSchema?: unknown
  promptSnippet?: string
  promptGuidelines?: string[]
  timeoutMs?: number
  prepareArguments?: (args: unknown) => Static<TParameters>
  execute(
    callId: string,
    args: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateHandler,
    context?: ExecutableToolContext,
  ): Promise<Omit<ToolExecutionResult, 'status' | 'details'> & { details: TDetails }>
}

export type ExecutableToolOptions<TParameters extends TSchema, TDetails = unknown> = Omit<
  ExecutableTool<TParameters, TDetails>,
  'label'
> & {
  label?: string
}

export function defineExecutableTool<TParameters extends TSchema, TDetails = unknown>(
  tool: ExecutableToolOptions<TParameters, TDetails>,
): ExecutableTool<TParameters, TDetails> {
  return { ...tool, label: tool.label ?? tool.name }
}
