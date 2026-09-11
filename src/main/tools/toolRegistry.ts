import type { ToolDefinition } from '@/shared/tool/tool'

export interface ToolAdapterContext {
  cwd: string
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

  register<TTool>(registration: ToolRegistration<TTool>): void {
    const { name } = registration.definition
    if (this.registrations.has(name)) {
      throw new Error(`Tool already registered: ${name}`)
    }

    this.registrations.set(name, registration as ToolRegistration)
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
