import { spawn, spawnSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ToolExecutionError } from '@/shared/tool/toolExecutionResult'
import type {
  SandboxBackend,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxSupport,
} from './sandboxBackend'

function launcherPath(): string {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const paths = [
    ...(resources
      ? [join(resources, 'app.asar.unpacked', 'resources', 'sandbox', 'windows-sandbox.exe')]
      : []),
    fileURLToPath(new URL('../../resources/sandbox/windows-sandbox.exe', import.meta.url)),
    fileURLToPath(new URL('../../../resources/sandbox/windows-sandbox.exe', import.meta.url)),
  ]
  return paths.find((path) => existsSync(path)) ?? paths[paths.length - 1]
}

export class WindowsSandboxBackend implements SandboxBackend {
  private readonly directories = new Map<string, Promise<string>>()
  private readonly executions = new Map<string, Set<Promise<SandboxExecutionResult>>>()
  constructor(
    private readonly userData = join(process.env.APPDATA ?? homedir(), 'kklyeenook'),
    private readonly launcher = launcherPath(),
  ) {}

  support(): SandboxSupport {
    const check = spawnSync(this.launcher, ['--check-enforcement'], {
      windowsHide: true,
      timeout: 5000,
    })
    return check.status === 0 ? 'partial' : 'unavailable'
  }

  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    const runId = request.runId ?? randomUUID()
    const execution = this.executeRestricted(request, runId)
    const active = this.executions.get(runId) ?? new Set<Promise<SandboxExecutionResult>>()
    this.executions.set(runId, active)
    active.add(execution)
    try {
      return await execution
    } finally {
      active.delete(execution)
      if (active.size === 0) this.executions.delete(runId)
      if (!request.runId) await this.finishRun(runId)
    }
  }

  async finishRun(runId: string): Promise<void> {
    await Promise.allSettled(this.executions.get(runId) ?? [])
    const directory = this.directories.get(runId)
    this.directories.delete(runId)
    if (directory) await rm(await directory, { recursive: true, force: true })
  }

  private runDirectory(runId: string): Promise<string> {
    let directory = this.directories.get(runId)
    if (!directory) {
      directory = this.createRunDirectory(runId).catch((error) => {
        this.directories.delete(runId)
        throw error
      })
      this.directories.set(runId, directory)
    }
    return directory
  }

  private async createRunDirectory(runId: string): Promise<string> {
    const root = join(this.userData, 'sandbox')
    await mkdir(root, { recursive: true })
    const run = createHash('sha256').update(runId).digest('hex').slice(0, 24)
    const directory = await mkdtemp(join(root, `${run}-`))
    try {
      await mkdir(join(directory, 'tmp'))
      return directory
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  private async executeRestricted(
    request: SandboxExecutionRequest,
    runId: string,
  ): Promise<SandboxExecutionResult> {
    if (request.mode === 'full-access')
      throw new Error('Restricted execution requires a sandbox mode')
    request.signal?.throwIfAborted()
    try {
      if (!request.workspaceRoot) throw new Error('Sandbox execution requires a workspace')
      const workspace = await realpath(request.workspaceRoot)
      const cwd = await realpath(request.cwd ?? workspace)
      const runDirectory = await this.runDirectory(runId)
      const privateTemp = join(runDirectory, 'tmp')
      const canonicalTemp = await realpath(privateTemp)
      request.signal?.throwIfAborted()
      const chunks: Buffer[] = []
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(
          this.launcher,
          [request.mode, workspace, canonicalTemp, cwd, request.command],
          {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...process.env,
              TEMP: canonicalTemp,
              TMP: canonicalTemp,
              TMPDIR: canonicalTemp,
              npm_config_cache: join(canonicalTemp, 'npm-cache'),
              PYTHONPYCACHEPREFIX: join(canonicalTemp, 'pycache'),
            },
          },
        )
        const cancel = () => child.stdin.end()
        child.stdin.on('error', () => undefined)
        child.stdout.on('data', (data) => chunks.push(Buffer.from(data)))
        child.stderr.on('data', (data) => chunks.push(Buffer.from(data)))
        child.once('error', reject)
        child.once('close', (code) => {
          request.signal?.removeEventListener('abort', cancel)
          if (request.signal?.aborted) reject(request.signal.reason)
          else if (code === null || code === 125)
            reject(
              new Error(Buffer.concat(chunks).toString('utf8').trim() || 'Sandbox launcher failed'),
            )
          else resolve(code)
        })
        request.signal?.addEventListener('abort', cancel, { once: true })
        if (request.signal?.aborted) cancel()
      })
      const text = Buffer.concat(chunks).toString('utf8')
      return {
        content: [
          {
            type: 'text',
            text: exitCode === 0 ? text : `${text}\nCommand exited with code ${exitCode}`,
          },
        ],
        details: {
          exitCode,
          sandbox: { mode: request.mode, backend: 'windows-acl', enforcement: 'partial' },
        },
        isError: exitCode !== 0,
      }
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason
      throw new ToolExecutionError(
        'EXECUTION_ERROR',
        `Failed to start sandboxed process: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
