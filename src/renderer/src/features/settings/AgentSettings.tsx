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
      <div className="py-5">
        <header className="mb-2 px-4">
          <h2 className="text-sm font-semibold">上下文</h2>
          <p className="text-muted-foreground mt-1 text-xs">管理对话容量和历史内容压缩。</p>
        </header>
        <ContextSettings settings={settings} onChanged={onChanged} />
      </div>
      <div className="py-5">
        <header className="mb-2 px-4">
          <h2 className="text-sm font-semibold">网络搜索</h2>
          <p className="text-muted-foreground mt-1 text-xs">让 Agent 获取最新的网络信息。</p>
        </header>
        <WebSearchSettings settings={settings} onChanged={onChanged} />
      </div>
      <div className="py-5">
        <header className="mb-2 px-4">
          <h2 className="text-sm font-semibold">权限与安全</h2>
          <p className="text-muted-foreground mt-1 text-xs">设置操作范围，查看和撤销临时授权。</p>
        </header>
        <PermissionSettings settings={settings} onChanged={onChanged} />
      </div>
    </SettingsCard>
  )
}
