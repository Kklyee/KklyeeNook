import type { PermissionMode } from '@/shared/approval/permission'
import type { AgentExecutionContext } from '@/shared/workspace/workspace'
import type { ToolDefinition } from '@/shared/tool/tool'

export interface ToolAdapterContext {
  cwd?: string
  executionContext?: AgentExecutionContext & { mode?: PermissionMode }
  getRunId?: () => string | undefined
}

export interface ToolAdapter<TTool = unknown> {
  runtime: string
  create(context: ToolAdapterContext): TTool
}

export interface ToolRegistration<TTool = unknown> {
  definition: ToolDefinition
  adapter: ToolAdapter<TTool>
}

export class ToolRegistry {
  private readonly registrations = new Map<string, ToolRegistration>()
  private revision = 0

  register<TTool>(registration: ToolRegistration<TTool>): () => void {
    const { name } = registration.definition
    if (registration.definition.inputSchema === undefined) throw new Error(`Tool input schema is required: ${name}`)
    if (this.registrations.has(name)) {
      throw new Error(`Tool already registered: ${name}`)
    }

    const stored = registration as ToolRegistration
    this.registrations.set(name, stored)
    this.revision += 1
    return () => {
      if (this.registrations.get(name) !== stored) return
      this.registrations.delete(name)
      this.revision += 1
    }
  }

  getRevision(): number {
    return this.revision
  }

  get(name: string): ToolDefinition | undefined {
    return this.registrations.get(name)?.definition
  }

  list(): ToolDefinition[] {
    return Array.from(this.registrations.values(), ({ definition }) => definition)
  }

  resolve<TTool>(runtime: string, names: readonly string[], context: ToolAdapterContext): TTool[] {
    return names.map((name) => {
      const registration = this.registrations.get(name)
      if (!registration) {
        throw new Error(`Unknown tool: ${name}`)
      }
      if (registration.adapter.runtime !== runtime) {
        throw new Error(`Tool "${name}" does not support runtime "${runtime}"`)
      }

      return registration.adapter.create(context) as TTool
    })
  }
}
