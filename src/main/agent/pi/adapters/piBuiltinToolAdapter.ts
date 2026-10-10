import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { rgPath } from '@vscode/ripgrep'
import type { Context } from '@earendil-works/chord'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { createEditTool, createWriteTool } from '@earendil-works/pi-durable/tools'
import { Type, type TSchema } from 'typebox'
import type { ToolRegistry } from '@/main/tools/toolRegistry'
import type { ExecutableTool } from '@/main/tools/executable-tool'
import { defineExecutableTool } from '@/main/tools/executable-tool'
import { resolveShellRuntime } from '@/main/sandbox/shellRuntime'
import { launchShellProcess } from '@/main/sandbox/processLauncher'

const readSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to read (relative or absolute)' }),
  offset: Type.Optional(Type.Integer({ minimum: 1, description: 'Line number to start reading from (1-indexed)' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: 'Maximum number of lines to read' })),
})

const findSchema = Type.Object({
  pattern: Type.String({ description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'" }),
  path: Type.Optional(Type.String({ description: 'Directory to search in (default: current directory)' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: 'Maximum number of results' })),
})

const grepSchema = Type.Object({
  pattern: Type.String({ description: 'Search pattern (regex or literal string)' }),
  path: Type.Optional(Type.String({ description: 'Directory or file to search (default: current directory)' })),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive search (default: false)' })),
  literal: Type.Optional(Type.Boolean({ description: 'Treat pattern as literal string instead of regex (default: false)' })),
  context: Type.Optional(Type.Integer({ minimum: 0, description: 'Number of lines to show before and after each match (default: 0)' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: 'Maximum number of matches to return' })),
})

const shellSchema = Type.Object({
  command: Type.String({ description: 'Shell command to execute' }),
  timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 2147483, description: 'Timeout in seconds (optional, no default timeout)' })),
  cwd: Type.Optional(Type.String({ description: 'Explicit command working directory; required without a workspace' })),
})

const editSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
  edits: Type.Array(
    Type.Object({
      oldText: Type.String({ description: 'Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.' }),
      newText: Type.String({ description: 'Replacement text for this targeted edit.' }),
    }),
    { description: 'One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.' },
  ),
})

const writeSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to write (relative or absolute)' }),
  content: Type.String({ description: 'Content to write to the file' }),
})

type AnyPiToolDefinition = ExecutableTool<TSchema, any>

type RgResult = { stdout: string; stderr: string; exitCode: number }

function createToolContext(signal?: AbortSignal): Context {
  return {
    abortSignal: signal,
    value: () => undefined,
    toString: () => 'nook-tool-execution',
  }
}

function createToolApi(cwd: string, callId: string): ToolExecutionApi<any> {
  const env = new NodeExecutionEnv({ cwd })
  return {
    callId,
    env,
    output: () => undefined,
    outputWindow: undefined,
    diagnostic: () => undefined,
    details: async () => undefined,
    taskId: 'nook-tool' as never,
    conversationId: 'nook-conversation' as never,
    registry: {} as never,
    models: {} as never,
    agent: async () => ({} as never),
    commit: async () => {
      throw new Error('Tool commits are unavailable')
    },
    memo: async (_name: string, candidate?: unknown) => candidate as never,
    createTask: async () => {
      throw new Error('Tool tasks are unavailable')
    },
    getTask: async () => undefined,
    waitForTask: async () => {
      throw new Error('Tool tasks are unavailable')
    },
    conversation: async () => undefined,
  } as unknown as ToolExecutionApi<any>
}

async function executeDurableTool<TArgs>(
  cwd: string,
  callId: string,
  signal: AbortSignal | undefined,
  execute: (args: TArgs, api: ToolExecutionApi<any>, context: Context) => Promise<any>,
  args: TArgs,
): Promise<any> {
  signal?.throwIfAborted()
  return await execute(args, createToolApi(cwd, callId), createToolContext(signal))
}

function createRead(cwd: string): AnyPiToolDefinition {
  return defineExecutableTool({
    name: 'read',
    label: 'read',
    description:
      'Read a file or image. offset is a one-based line number; limit is a number of lines. Large results are retained with a resultRef for read_tool_result.',
    promptSnippet: 'Read file contents',
    promptGuidelines: ['Use read to examine files instead of cat or sed.'],
    parameters: readSchema,
    async execute(_id, input, signal) {
      const args = input as { path: string; offset?: number; limit?: number }
      signal?.throwIfAborted()
      const path = resolve(cwd, args.path)
      const imageMimeType = detectImageMimeType(path, await readFile(path, { signal }))
      if (imageMimeType) return readImage(path, imageMimeType, signal)
      const text = await readFile(path, { encoding: 'utf8', signal })
      const lines = text.split('\n')
      const start = (args.offset ?? 1) - 1
      if (start >= lines.length)
        throw new Error(`Offset ${args.offset} exceeds file length (${lines.length} lines)`)
      return {
        content: [
          {
            type: 'text' as const,
            text: lines.slice(start, args.limit === undefined ? undefined : start + args.limit).join('\n'),
          },
        ],
        details: {},
      }
    },
  })
}

async function readImage(path: string, mimeType: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const { default: sharp } = await import('sharp')
  const image = sharp(path, { animated: false }).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
  const data = await image.webp().toBuffer()
  signal?.throwIfAborted()
  return {
    content: [{ type: 'image' as const, data: data.toString('base64'), mimeType: 'image/webp' }],
    details: { originalMimeType: mimeType },
  }
}

function detectImageMimeType(path: string, bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (bytes.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp'
  if (/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(path)) return 'image/unknown'
  return undefined
}

function createFind(cwd: string): AnyPiToolDefinition {
  return defineExecutableTool({
    name: 'find',
    label: 'find',
    description:
      'Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Large results are retained with a resultRef for read_tool_result.',
    promptSnippet: 'Find files by glob pattern (respects .gitignore)',
    parameters: findSchema,
    async execute(_id, input, signal) {
      const args = input as { pattern: string; path?: string; limit?: number }
      const searchPath = resolve(cwd, args.path ?? '.')
      const result = await runRg(['--files', '--color', 'never', '--glob', args.pattern, '--', searchPath], signal)
      if (result.exitCode > 1) throw new Error(result.stderr.trim() || `rg exited with code ${result.exitCode}`)
      let matches = result.stdout.split(/\r?\n/).filter(Boolean)
      matches = matches.map((item) => {
        const output = relative(searchPath, item)
        return output.startsWith('..') ? item : output || item
      })
      if (args.limit !== undefined) matches = matches.slice(0, args.limit)
      return { content: [{ type: 'text' as const, text: matches.join('\n') }], details: { matches } }
    },
  })
}

function createGrep(cwd: string): AnyPiToolDefinition {
  return defineExecutableTool({
    name: 'grep',
    label: 'grep',
    description:
      'Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Large results are retained with a resultRef for read_tool_result.',
    promptSnippet: 'Search file contents for patterns (respects .gitignore)',
    parameters: grepSchema,
    async execute(_id, input, signal) {
      const args = input as { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; literal?: boolean; context?: number; limit?: number }
      const searchPath = resolve(cwd, args.path ?? '.')
      const rgArgs = ['--json', '--line-number', '--color', 'never']
      if (args.ignoreCase) rgArgs.push('--ignore-case')
      if (args.literal) rgArgs.push('--fixed-strings')
      if (args.context !== undefined) rgArgs.push('--context', String(args.context))
      if (args.glob) rgArgs.push('--glob', args.glob)
      rgArgs.push('--', args.pattern, searchPath)
      const result = await runRg(rgArgs, signal)
      if (result.exitCode > 1) throw new Error(result.stderr.trim() || `rg exited with code ${result.exitCode}`)
      const matches = parseRgMatches(result.stdout, searchPath, args.limit)
      return { content: [{ type: 'text' as const, text: matches.map((match) => match.text).join('\n') }], details: { matches } }
    },
  })
}

function parseRgMatches(output: string, root: string, limit?: number) {
  const matches: Array<{ path: string; line: number; text: string; kind: 'match' | 'context' }> = []
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue
    const item = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } }
    if (item.type !== 'match' && item.type !== 'context') continue
    const path = item.data?.path?.text
    const lineNumber = item.data?.line_number
    const text = item.data?.lines?.text?.replace(/[\r\n]+$/, '')
    if (!path || lineNumber === undefined || text === undefined) continue
    const relativePath = relative(root, path)
    const displayPath = relativePath && !relativePath.startsWith('..') ? relativePath : path
    matches.push({ path: displayPath, line: lineNumber, text: `${displayPath}:${lineNumber}:${text}`, kind: item.type })
    if (limit !== undefined && matches.filter((match) => match.kind === 'match').length >= limit) break
  }
  return matches
}

async function runRg(args: string[], signal?: AbortSignal): Promise<RgResult> {
  signal?.throwIfAborted()
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(rgPath.replace('app.asar', 'app.asar.unpacked'), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const abort = () => {
      child.kill()
      reject(signal?.reason ?? new Error('Operation aborted'))
    }
    child.stdout.on('data', (data) => stdout.push(Buffer.from(data)))
    child.stderr.on('data', (data) => stderr.push(Buffer.from(data)))
    child.once('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(new Error(`ripgrep is unavailable: ${error.message}`))
    })
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(signal.reason)
      else resolvePromise({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code ?? 1 })
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

function createShell(cwd: string): AnyPiToolDefinition {
  return defineExecutableTool({
    name: 'bash',
    label: 'Shell',
    promptSnippet: process.platform === 'win32' ? 'Run PowerShell 7 commands (git, package managers, tests and project CLIs) in the native workspace cwd' : 'Run shell commands in the workspace cwd',
    promptGuidelines: process.platform === 'win32'
      ? ['Use PowerShell 7 syntax and native Windows paths for Shell commands. Use read, write, edit, grep and find for native file operations.']
      : ['You can inspect PI_* environment variables for current model and session details.'],
    description:
      process.platform === 'win32'
        ? 'Execute a PowerShell 7 command using native Windows paths in all permission modes. The launcher sets cwd to the workspace root unless an explicit cwd is supplied. Return stdout, stderr and exit code. Optional timeout is in seconds. Large results are retained with a resultRef for read_tool_result.'
        : 'Execute a shell command and return stdout and stderr. Optional timeout is in seconds. Large results are retained with a resultRef for read_tool_result.',
    parameters: shellSchema,
    async execute(_id, input, signal) {
      const args = input as { command: string; cwd?: string }
      return launchShellProcess(resolveShellRuntime({ workspaceRoot: args.cwd ?? cwd }), args.command, signal)
    },
  })
}

function createEdit(cwd: string): AnyPiToolDefinition {
  const tool = createEditTool()
  return defineExecutableTool({
    name: 'edit',
    label: 'edit',
    description: tool.description,
    promptSnippet: 'Make precise file edits with exact text replacement, including multiple disjoint edits in one call',
    promptGuidelines: [
      'Use edit for precise changes (edits[].oldText must match exactly)',
      'When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls',
      'Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.',
      'Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.',
    ],
    parameters: editSchema,
    prepareArguments: tool.prepareArguments as never,
    async execute(id, input, signal) {
      return executeDurableTool(cwd, id, signal, tool.execute, input as never)
    },
  })
}

function createWrite(cwd: string): AnyPiToolDefinition {
  const tool = createWriteTool()
  return defineExecutableTool({
    name: 'write',
    label: 'write',
    description: tool.description,
    promptSnippet: 'Create or overwrite files',
    promptGuidelines: ['Use write only for new files or complete rewrites.'],
    parameters: writeSchema,
    async execute(id, input, signal) {
      const args = input as { path: string; content: string }
      const existed = existsSync(resolve(cwd, args.path))
      const result = await executeDurableTool(cwd, id, signal, tool.execute, args as never)
      return {
        ...(result as object),
        details: { ...(result as { details?: object }).details, created: !existed, updated: existed },
      } as never
    },
  })
}

export function registerPiBuiltinTools(registry: ToolRegistry, metadataCwd: string): void {
  const factories: Array<(cwd: string) => AnyPiToolDefinition> = [
    createRead,
    createFind,
    createGrep,
    createShell,
    createEdit,
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
