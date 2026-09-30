import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

export class KnowledgeWorker {
  private process?: ChildProcessWithoutNullStreams
  private nextId = 0
  private stderr = ''
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()

  constructor(private readonly pythonPath: string, private readonly scriptPath: string) {}

  request<T>(input: Record<string, unknown>): Promise<T> {
    const child = this.process ?? this.start()
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close(new Error('Knowledge worker timed out. Check model downloads and Python dependencies.'))
      }, 15 * 60_000)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      child.stdin.write(`${JSON.stringify({ ...input, id })}\n`, (error) => {
        if (error) this.close(error)
      })
    })
  }

  close(error = new Error('Knowledge worker closed')): void {
    const child = this.process
    this.process = undefined
    child?.kill()
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    this.pending.clear()
  }

  private start(): ChildProcessWithoutNullStreams {
    this.stderr = ''
    const child = spawn(this.pythonPath, ['-u', this.scriptPath], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', TOKENIZERS_PARALLELISM: 'false' },
    })
    this.process = child
    child.stderr.on('data', (data: Buffer) => {
      this.stderr = (this.stderr + data.toString()).slice(-4000)
    })
    child.on('error', (error) => {
      if (this.process === child) this.close(new Error(`Cannot start Knowledge Python: ${error.message}. Install resources/knowledge/requirements.txt and configure Python path.`))
    })
    child.on('exit', (code) => {
      if (this.process === child) this.close(new Error(`Knowledge Python exited (${code}): ${this.stderr}`))
    })
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      try {
        const result = JSON.parse(line) as { id: number; value?: unknown; error?: string }
        const item = this.pending.get(result.id)
        if (!item) return
        this.pending.delete(result.id)
        clearTimeout(item.timer)
        if (result.error) item.reject(new Error(result.error))
        else item.resolve(result.value)
      } catch {
        this.close(new Error('Invalid Knowledge worker response'))
      }
    })
    return child
  }
}
