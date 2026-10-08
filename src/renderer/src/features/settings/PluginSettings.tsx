import { Tabs } from '@base-ui/react/tabs'
import { BookOpenIcon, BrainIcon, ServerIcon, SparklesIcon } from 'lucide-react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { KnowledgeSettings } from './KnowledgeSettings'
import { McpSettings } from './McpSettings'
import { MemorySettings } from './MemorySettings'
import { SkillSettings } from './SkillSettings'

const pluginTabs = [
  { id: 'skills', label: 'Skills', icon: SparklesIcon, panel: SkillSettings },
  { id: 'memory', label: 'Memory', icon: BrainIcon, panel: MemorySettings },
  { id: 'mcp', label: 'MCP', icon: ServerIcon, panel: McpSettings },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpenIcon, panel: KnowledgeSettings },
]

export function PluginSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  return (
    <Tabs.Root defaultValue="skills">
      <Tabs.List
        aria-label="插件类别"
        className="material-control mb-6 flex w-fit max-w-full flex-wrap gap-1 rounded-lg p-1"
      >
        {pluginTabs.map(({ id, label, icon: Icon }) => (
          <Tabs.Tab
            key={id}
            value={id}
            className="text-muted-foreground hover:text-foreground data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm focus-visible:ring-ring inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2"
          >
            <Icon className="size-3.5" />
            {label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {pluginTabs.map(({ id, panel: Panel }) => (
        <Tabs.Panel key={id} value={id}>
          <Panel settings={settings} onChanged={onChanged} />
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  )
}
