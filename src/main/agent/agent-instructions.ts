import { open, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@earendil-works/chord'
import {
  defineExtension,
  section,
  type ConversationId,
  type PromptInput,
} from '@earendil-works/pi-durable'

export type WorkspaceInstructions = {
  workspaceRoot: string
  instructionRoot?: string
  targetDirectory?: string
}

export type InstructionFile = { path: string; content: string }

function contains(root: string, path: string) {
  const child = relative(root, path)
  return (
    child !== '..' &&
    !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(child)
  )
}

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export class AgentInstructions {
  private readonly cache = new Map<
    string,
    { mtimeMs: number; size: number; file: InstructionFile }
  >()

  constructor(private readonly maxBytes = 64 * 1024) {}

  async load(input: WorkspaceInstructions): Promise<InstructionFile[]> {
    const workspace = await realpath(input.workspaceRoot)
    const boundary = input.instructionRoot ? await realpath(input.instructionRoot) : workspace
    if (!contains(boundary, workspace))
      throw new Error('Workspace is outside the authorized instruction root')
    const requested = resolve(input.workspaceRoot, input.targetDirectory ?? '.')
    if (!contains(resolve(input.workspaceRoot), requested))
      throw new Error('Instruction target is outside the Workspace')
    let target = requested
    while (true) {
      try {
        target = await realpath(target)
        break
      } catch (error) {
        if (!missing(error) || dirname(target) === target) throw error
        target = dirname(target)
      }
    }
    if (!contains(workspace, target)) throw new Error('Instruction target escapes the Workspace')
    const directories = [target]
    while (relative(boundary, directories[0]) !== '') directories.unshift(dirname(directories[0]))
    const files: InstructionFile[] = []
    for (const directory of directories) {
      const path = join(directory, 'AGENTS.md')
      let canonical: string
      try {
        canonical = await realpath(path)
      } catch (error) {
        if (missing(error)) continue
        throw new Error(`Unable to read ${path}`, { cause: error })
      }
      if (!contains(boundary, canonical))
        throw new Error(`Instruction file escapes the authorized root: ${path}`)
      const metadata = await stat(canonical)
      if (!metadata.isFile()) throw new Error(`Instruction path is not a file: ${path}`)
      if (metadata.size > this.maxBytes)
        throw new Error(`Instruction file exceeds ${this.maxBytes} bytes: ${path}`)
      const cached = this.cache.get(canonical)
      if (cached?.mtimeMs === metadata.mtimeMs && cached.size === metadata.size) {
        files.push(cached.file)
        continue
      }
      const handle = await open(canonical, 'r')
      try {
        const bytes = Buffer.alloc(this.maxBytes + 1)
        let bytesRead = 0
        while (bytesRead < bytes.length) {
          const read = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead)
          if (!read.bytesRead) break
          bytesRead += read.bytesRead
        }
        if (bytesRead > this.maxBytes)
          throw new Error(`Instruction file exceeds ${this.maxBytes} bytes: ${path}`)
        let content: string
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))
        } catch (error) {
          throw new Error(`Instruction file is not valid UTF-8: ${path}`, { cause: error })
        }
        const file = { path: canonical, content }
        this.cache.set(canonical, { mtimeMs: metadata.mtimeMs, size: metadata.size, file })
        files.push(file)
      } finally {
        await handle.close()
      }
    }
    return files
  }

  invalidate() {
    this.cache.clear()
  }
}

export function createAgentInstructions(options: {
  identity: 'coding' | 'personal'
  loader: AgentInstructions
  workspace(
    conversationId: ConversationId,
    context: Context,
  ): Promise<WorkspaceInstructions | undefined>
  environment?(
    input: PromptInput,
    context: Context,
  ): string | undefined | Promise<string | undefined>
}) {
  return defineExtension({
    name: `nook.${options.identity}`,
    sections: [
      section('identity', () =>
        options.identity === 'coding'
          ? 'You are the KKlyeeNook coding agent. Help with the authorized development workspace.'
          : 'You are the KKlyeeNook personal assistant. Help the user with their personal goals.',
      ),
      section('environment', (input, context) => options.environment?.(input, context)),
      section('workspace', async (input, context) => {
        if (options.identity !== 'coding') return undefined
        const workspace = await options.workspace(input.conversationId, context)
        if (!workspace) return undefined
        const files = await options.loader.load(workspace)
        return files.length
          ? files
              .map((file) => `Workspace instructions from ${file.path}:\n${file.content}`)
              .join('\n\n')
          : undefined
      }),
    ],
  })
}
