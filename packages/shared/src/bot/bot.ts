import type { ThinkingLevel } from '../agent/agentConfig'
import type { PermissionMode } from '../approval/permission'

export const AVATAR_VARIANTS = ['beam', 'bauhaus', 'marble', 'pixel', 'ring', 'sunset'] as const
export const BOT_COLORS = ['#6bbfaf', '#f3b66d', '#ad9ee9', '#e89bad', '#f8f5ed']

export type BotAvatarConfig = {
  seed: string
  variant: (typeof AVATAR_VARIANTS)[number]
  colors: string[]
  accentColor: string
}

export type BotProfile = {
  id: string
  name: string
  role: string
  kind: 'personal' | 'coding'
  instructions: string
  isBuiltIn: boolean
  model: { provider: string; modelId: string } | null
  thinkingLevel: ThinkingLevel | null
  enabledTools: string[]
  workspaceIds: string[]
  defaultWorkspaceId: string | null
  permissionMode: PermissionMode
  avatar: BotAvatarConfig
  mainThreadId: string
  createdAt: number
  updatedAt: number
}

export type BotInput = Partial<Omit<BotProfile, 'id' | 'isBuiltIn' | 'mainThreadId' | 'createdAt' | 'updatedAt'>> & { name: string }
export type BotState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error'
export type BotSummary = BotProfile & { state: BotState }

export function defaultBot(id: string, name: string, coding = false): BotProfile {
  const now = Date.now()
  return {
    id, name, role: coding ? 'Coding Agent' : 'Personal Agent', kind: coding ? 'coding' : 'personal',
    instructions: coding
      ? 'Help with code development, documentation, debugging and tests. Follow the authorized workspace instructions and request approval for side effects when required.'
      : 'Help with daily work, planning, goals, knowledge and research. Use a warm, clear voice and respect the user’s permissions.',
    isBuiltIn: id === 'xiaoya' || id === 'coder', model: null, thinkingLevel: null,
    enabledTools: coding ? ['read', 'write', 'edit', 'bash', 'find', 'grep', 'update_plan', 'read_tool_result'] : ['save_memory', 'update_plan', 'web_search', 'search_knowledge', 'read_knowledge', 'read_tool_result'],
    workspaceIds: [], defaultWorkspaceId: null, permissionMode: coding ? 'workspace-write' : 'read-only',
    avatar: { seed: id, variant: 'beam', colors: [...BOT_COLORS], accentColor: coding ? '#f3b66d' : '#6bbfaf' },
    mainThreadId: `bot:${id}:main`, createdAt: now, updatedAt: now,
  }
}
