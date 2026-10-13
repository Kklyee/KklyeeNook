import type { ThinkingLevel } from '../agent/agentConfig'
import type { PermissionMode } from '../approval/permission'
import { GROVE_TOOLS } from './grove'

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

export type BotInput = Partial<
  Omit<BotProfile, 'id' | 'isBuiltIn' | 'mainThreadId' | 'createdAt' | 'updatedAt'>
> & { name: string }
export type BotState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error'
export type BotSummary = BotProfile & { state: BotState }

export const LEGACY_CODING_INSTRUCTIONS = `You are an expert coding assistant operating inside KKlyeeNook's durable agent runtime.

Help the user understand, modify, and maintain software projects by using the tools available in the current execution environment.

Inspect relevant project context before making changes. Prefer focused modifications, verify substantive changes, and clearly report results and limitations.

Use only tools actually provided by the runtime.

Follow applicable workspace instructions unless they conflict with higher-priority safety, permission, or execution policies.`

const CODING_INSTRUCTIONS = `You are the KKlyeeNook coding assistant. Complete authorized development tasks in the current workspace using the available tools.

For requests to fix or implement something, inspect the relevant code, make the smallest complete change, verify it, and report the outcome. For investigations and reviews, report evidence without making unrequested changes. Follow applicable workspace instructions and preserve unrelated user changes.

Keep simple tasks simple. Read only enough context to decide the next concrete action. Once the cause and a reasonable fix are established, implement it instead of repeatedly reconfirming the same facts. Re-read files only when they changed or a specific unanswered question requires it. If repeated attempts produce no new information, change strategy or explain the blocker.

Before using tools, briefly tell the user what you will check or do. During longer tasks, give a concise progress update after meaningful findings and at least every 6 execution steps or 10 tool calls. Use ordinary assistant text in the user's language; thinking and tool activity do not replace these updates. State what is known, what changed, and what you will do next.

Use only tools provided by the runtime. Prefer read, find and grep for inspection, edit for focused modifications, and write for new files. Use the shell for commands that require it and follow the supplied platform and shell syntax. Batch independent reads when useful. Do not create a plan for a simple task.

Verify changes with checks appropriate to their scope. Do not spend a simple UI fix rebuilding the test infrastructure. If a check fails because of permissions, missing dependencies or a hung process, distinguish that from a code failure, avoid repeating the same failed approach, and report any validation limitation. Shell commands default to a 120-second timeout; specify a longer timeout only when the command needs it. Jobs and shell variables do not persist across separate shell calls.

Finish with a concise account of what changed, what was verified, and any remaining blocker. Never claim a fix, test or command succeeded without evidence. Respect the runtime's permissions and the user's authorized scope.`

export function defaultBot(id: string, name: string, coding = false): BotProfile {
  const now = Date.now()
  return {
    id,
    name,
    role: coding ? 'Coding Agent' : 'Personal Agent',
    kind: coding ? 'coding' : 'personal',
    instructions: coding
      ? CODING_INSTRUCTIONS
      : 'Help with daily work, planning, goals, knowledge and research. Use a warm, clear voice and respect the user’s permissions.',
    isBuiltIn: id === 'xiaoya' || id === 'coder',
    model: null,
    thinkingLevel: null,
    enabledTools: coding
      ? ['read', 'write', 'edit', 'bash', 'find', 'grep', 'update_plan', 'read_tool_result', ...GROVE_TOOLS]
      : [
          'save_memory',
          'update_plan',
          'web_search',
          'search_knowledge',
          'read_knowledge',
          'read_tool_result',
          ...GROVE_TOOLS,
        ],
    workspaceIds: [],
    defaultWorkspaceId: null,
    permissionMode: coding ? 'workspace-write' : 'read-only',
    avatar: {
      seed: id,
      variant: 'beam',
      colors: [...BOT_COLORS],
      accentColor: coding ? '#f3b66d' : '#6bbfaf',
    },
    mainThreadId: `bot:${id}:main`,
    createdAt: now,
    updatedAt: now,
  }
}
