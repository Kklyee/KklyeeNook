import { spawn, spawnSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ToolExecutionError } from '@/shared/tool/toolExecutionResult'
import { shellArgs, shellExecutable, resolveShellRuntime } from './shellRuntime'
import { shellResult } from './processLauncher'
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
  private cachedSupport?: SandboxSupport
  private readonly directories = new Map<string, Promise<string>>()
  private readonly executions = new Map<string, Set<Promise<SandboxExecutionResult>>>()
  constructor(
    private readonly userData = join(process.env.APPDATA ?? homedir(), 'kklyeenook'),
    private readonly launcher = launcherPath(),
  ) {}

  support(): SandboxSupport {
    if (this.cachedSupport) return this.cachedSupport
    const check = spawnSync(this.launcher, ['--check-enforcement'], {
      windowsHide: true,
      timeout: 5000,
    })
    this.cachedSupport = check.status === 0 ? 'partial' : 'unavailable'
    return this.cachedSupport
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
    if (directory) await directory
    await Promise.all((await this.runDirectories(runId)).map((path) => rm(path, { recursive: true, force: true })))
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
    const existing = await this.runDirectories(runId)
    const directory = existing[0] ?? await mkdtemp(join(root, `${run}-`))
    try {
      const temp = join(directory, 'tmp')
      await mkdir(temp, { recursive: true })
      const info = await lstat(temp)
      if (info.isSymbolicLink() || !info.isDirectory() || dirname(await realpath(temp)) !== await realpath(directory))
        throw new Error('Sandbox temporary directory has an invalid boundary')
      return directory
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  private async runDirectories(runId: string): Promise<string[]> {
    const root = join(this.userData, 'sandbox')
    let info
    try {
      info = await lstat(root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (info.isSymbolicLink() || !info.isDirectory() || dirname(await realpath(root)) !== await realpath(this.userData))
      throw new Error('Sandbox resource directory has an invalid boundary')
    const prefix = `${createHash('sha256').update(runId).digest('hex').slice(0, 24)}-`
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.name.startsWith(prefix) && entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => join(root, entry.name))
      .sort()
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
      const workspace = await realpath(request.workspaceRoot).catch((error) => {
        throw new ToolExecutionError('workspace_root_acl_failed', String(error))
      })
      const runtime = request.runtime ?? resolveShellRuntime({ workspaceRoot: request.cwd ?? workspace })
      const executable = shellExecutable(runtime)
      const cwd = await realpath(runtime.cwd)
      const runDirectory = await this.runDirectory(runId)
      const privateTemp = join(runDirectory, 'tmp')
      const canonicalTemp = await realpath(privateTemp)
      request.signal?.throwIfAborted()
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(
          this.launcher,
          [request.mode, workspace, canonicalTemp, cwd, executable, ...shellArgs(runtime, request.command)],
          {
            windowsHide: true,
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...runtime.env,
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
        child.stdout.on('data', (data) => stdout.push(Buffer.from(data)))
        child.stderr.on('data', (data) => stderr.push(Buffer.from(data)))
        child.once('error', (error) => {
          request.signal?.removeEventListener('abort', cancel)
          reject(new ToolExecutionError('process_spawn_failed', error.message))
        })
        child.once('close', (code) => {
          request.signal?.removeEventListener('abort', cancel)
          if (request.signal?.aborted) reject(request.signal.reason)
          else {
            const error = Buffer.concat(stderr).toString('utf8').trim()
            const launchError = error.match(/^Sandbox launch error \[(workspace_root_acl_failed|sandbox_policy_init_failed|process_spawn_failed)\]: ([\s\S]*)$/)
            if (launchError)
              reject(new ToolExecutionError(launchError[1] as 'workspace_root_acl_failed' | 'sandbox_policy_init_failed' | 'process_spawn_failed', `Sandbox could not start the process.\nReason: ${launchError[2]}`))
            else if (code === null)
              reject(new ToolExecutionError('process_spawn_failed', error || 'Sandbox launcher terminated'))
            else resolve(code)
          }
        })
        request.signal?.addEventListener('abort', cancel, { once: true })
        if (request.signal?.aborted) cancel()
      })
      const result = shellResult(runtime, Buffer.concat(stdout).toString('utf8'), Buffer.concat(stderr).toString('utf8'), exitCode)
      return {
        ...result,
        details: {
          ...result.details as Record<string, unknown>,
          sandbox: { mode: request.mode, backend: 'windows-acl', enforcement: 'partial' },
        },
      }
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason
      if (error instanceof ToolExecutionError) throw error
      throw new ToolExecutionError(
        'sandbox_policy_init_failed',
        `Sandbox could not start the process.\nReason: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
