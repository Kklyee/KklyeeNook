import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { parseFrontmatter } from '@earendil-works/pi-coding-agent'
import type { AgentSkill } from '@/shared/agent/agentSkill'

export function getUserSkillsDirectory(): string {
  return join(homedir(), '.agents', 'skills')
}

export interface SkillLoaderOptions {
  warn?: (message: string) => void
}

export class SkillLoader {
  private skills = new Map<string, AgentSkill>()
  private readonly warn: (message: string) => void

  constructor(
    readonly directory = getUserSkillsDirectory(),
    options: SkillLoaderOptions = {},
  ) {
    this.warn = options.warn ?? ((message) => console.warn(`[agent-backend] ${message}`))
  }

  listSkills(): AgentSkill[] {
    return [...this.skills.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  getSkill(id: string): AgentSkill | undefined {
    const skill = this.skills.get(id)
    return skill ?? this.listSkills().find((item) => item.name === id)
  }

  async reload(): Promise<AgentSkill[]> {
    try {
      const entries = await readdir(this.directory, { withFileTypes: true, encoding: 'utf8' })

      const nextSkills = new Map<string, AgentSkill>()
      const skills = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.loadSkill(join(this.directory, entry.name))),
      )
      for (const skill of skills) {
        if (skill) nextSkills.set(skill.id, skill)
      }

      this.skills = nextSkills
      return this.listSkills()
    } catch (error) {
      if (isMissingPathError(error)) {
        this.skills = new Map()
        return []
      }
      this.warn(`Unable to scan skills directory ${this.directory}: ${formatError(error)}`)
      this.skills = new Map()
      return []
    }
  }

  private async loadSkill(directory: string): Promise<AgentSkill | undefined> {
    const filePath = join(directory, 'SKILL.md')
    let content: string
    try {
      content = await readFile(filePath, 'utf8')
    } catch (error) {
      if (!isMissingPathError(error)) {
        this.warn(`Unable to read skill ${filePath}: ${formatError(error)}`)
      }
      return undefined
    }

    try {
      const parsed = parseFrontmatter(content)
      if (!isRecord(parsed.frontmatter)) throw new Error('frontmatter must be a mapping')

      const id = basename(directory)
      const name = readString(parsed.frontmatter.name) ?? id
      const description = readString(parsed.frontmatter.description)
      return {
        id,
        name,
        ...(description ? { description } : {}),
        instructions: parsed.body,
        directory,
      }
    } catch (error) {
      this.warn(`Skipping skill ${filePath}: ${formatError(error)}`)
      return undefined
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
