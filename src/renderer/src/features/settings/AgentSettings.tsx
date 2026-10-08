import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { ContextSettings } from './ContextSettings'
import { PermissionSettings } from './PermissionSettings'
import { SettingsCard } from './SettingsComponents'
import { WebSearchSettings } from './WebSearchSettings'

export function AgentSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  return (
    <SettingsCard>
      <div className="py-3">
        <header className="px-5 pt-2 pb-1">
          <h2 className="text-sm font-semibold">上下文</h2>
        </header>
        <ContextSettings settings={settings} onChanged={onChanged} />
      </div>
      <div className="py-3">
        <header className="px-5 pt-2 pb-1">
          <h2 className="text-sm font-semibold">网络搜索</h2>
        </header>
        <WebSearchSettings settings={settings} onChanged={onChanged} />
      </div>
      <div className="py-3">
        <header className="px-5 pt-2 pb-1">
          <h2 className="text-sm font-semibold">权限与安全</h2>
        </header>
        <PermissionSettings settings={settings} onChanged={onChanged} />
      </div>
    </SettingsCard>
  )
}
