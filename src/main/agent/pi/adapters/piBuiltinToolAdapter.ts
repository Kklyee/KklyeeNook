import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Type } from 'typebox'
import {
  createBashToolDefinition,
  createLocalBashOperations,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition as PiToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { ToolRegistry } from '@/main/tools/toolRegistry'

type AnyPiToolDefinition = PiToolDefinition<any, any, any>

function createRead(cwd: string): AnyPiToolDefinition {
  const tool = createReadToolDefinition(cwd) as AnyPiToolDefinition
  return {
    ...tool,
    description:
      'Read a file or image. offset is a one-based line number; limit is a number of lines. Large results are retained with a resultRef for read_tool_result.',
    parameters: Type.Object({
      path: Type.String(),
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(id, input, signal, onUpdate, context) {
      const args = input as { path: string; offset?: number; limit?: number }
      signal?.throwIfAborted()
      if (/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(args.path))
        return tool.execute(id, args, signal, onUpdate, context)
      const text = await readFile(args.path, { encoding: 'utf8', signal })
      const lines = text.split('\n')
      const start = (args.offset ?? 1) - 1
      if (start >= lines.length)
        throw new Error(`Offset ${args.offset} exceeds file length (${lines.length} lines)`)
      return {
        content: [
          {
            type: 'text',
            text: lines
              .slice(start, args.limit === undefined ? undefined : start + args.limit)
              .join('\n'),
          },
        ],
        details: {},
      }
    },
  }
}

function createBash(cwd: string): AnyPiToolDefinition {
  const tool = createBashToolDefinition(cwd) as AnyPiToolDefinition
  return {
    ...tool,
    description:
      process.platform === 'win32'
        ? 'Execute a shell command and return stdout and stderr. Windows read-only and workspace-write commands use cmd.exe syntax; full-access commands use Bash. Optional timeout is in seconds. Large results are retained with a resultRef for read_tool_result.'
        : 'Execute a shell command and return stdout and stderr. Optional timeout is in seconds. Large results are retained with a resultRef for read_tool_result.',
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 2147483 })),
      cwd: Type.Optional(
        Type.String({
          description: 'Explicit command working directory; required without a workspace',
        }),
      ),
    }),
    async execute(_id, input, signal) {
      const args = input as { command: string; cwd?: string }
      const chunks: Buffer[] = []
      const { exitCode } = await createLocalBashOperations().exec(args.command, args.cwd ?? cwd, {
        signal,
        onData: (data) => chunks.push(Buffer.from(data)),
      })
      const text = Buffer.concat(chunks).toString('utf8')
      return {
        content: [
          {
            type: 'text',
            text: exitCode === 0 ? text : `${text}\nCommand exited with code ${exitCode}`,
          },
        ],
        details: { exitCode },
        isError: exitCode !== 0,
      }
    },
  }
}

function createWrite(cwd: string): AnyPiToolDefinition {
  const tool = createWriteToolDefinition(cwd) as AnyPiToolDefinition
  return {
    ...tool,
    async execute(id, input, signal, onUpdate, context) {
      const existed = existsSync(resolve(cwd, (input as { path: string }).path))
      const result = await tool.execute(id, input, signal, onUpdate, context)
      return { ...result, details: { ...result.details, created: !existed, updated: existed } }
    },
  }
}

export function registerPiBuiltinTools(registry: ToolRegistry, metadataCwd: string): void {
  const factories: Array<(cwd: string) => AnyPiToolDefinition> = [
    createRead,
    createFindToolDefinition as (cwd: string) => AnyPiToolDefinition,
    createGrepToolDefinition as (cwd: string) => AnyPiToolDefinition,
    createBash,
    createEditToolDefinition as (cwd: string) => AnyPiToolDefinition,
    createWrite,
  ]
  for (const create of factories) {
    const tool = create(metadataCwd)
    registry.register({
      definition: {
        name: tool.name,
        label: tool.label,
        description: tool.description,
        inputSchema: tool.parameters,
      },
      adapter: { runtime: 'pi', create: ({ cwd }) => create(cwd ?? '') },
    })
  }
}
