import { useState, type ComponentType } from 'react'
import { ArrowLeftIcon, SearchIcon } from 'lucide-react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'
import { AgentSettings } from './AgentSettings'
import { PluginSettings } from './PluginSettings'
import { ModelSettings } from './ModelSettings'
import { settingsNavigation, type SettingsTab } from './settingsNavigation'
import { AppearanceSettings } from './AppearanceSettings'
import { RemoteSettings } from './RemoteSettings'

export function SettingsPage({
  settings,
  error,
  initialTab = 'model',
  onClose,
  onChanged,
}: {
  settings: AgentSettingsSnapshot | null
  error: string | null
  initialTab?: SettingsTab
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [search, setSearch] = useState('')
  const visibleTabs = settingsNavigation.filter(({ group, label, description, keywords }) =>
    `${group} ${label} ${description} ${keywords}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  )
  const activeTab = settingsNavigation.find((item) => item.id === tab) ?? settingsNavigation[0]

  return (
    <section
      className="material-base flex h-full min-h-0 w-full flex-col md:flex-row"
      aria-label="设置"
    >
      <aside className="material-panel text-sidebar-foreground flex w-full shrink-0 flex-col border-b md:h-full md:w-60 md:border-r md:border-b-0">
        <div className="px-3 pt-3 pb-2">
          <Button
            variant="ghost"
            className="h-8 justify-start gap-2 rounded-md px-2 text-xs font-normal"
            onClick={onClose}
          >
            <ArrowLeftIcon className="size-3.5" />
            返回应用
          </Button>
        </div>

        <div className="px-3 pb-3">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索设置…"
              aria-label="搜索设置"
              className="h-8 pl-8 text-xs shadow-none"
            />
          </div>
        </div>

        <nav aria-label="设置分类" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {(['应用', 'Agent', '扩展'] as const).map((group) => {
            const items = visibleTabs.filter((item) => item.group === group)
            if (items.length === 0) return null
            return (
              <div key={group} className="mb-4 space-y-0.5">
                <p className="text-muted-foreground px-2 pt-2 pb-1.5 text-[11px] font-medium">
                  {group}
                </p>
                {items.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={tab === id ? 'page' : undefined}
                    className={cn(
                      'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      tab === id
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                    )}
                    onClick={() => setTab(id)}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )
          })}
          {visibleTabs.length === 0 && (
            <p className="text-muted-foreground px-2 py-4 text-xs">没有匹配的设置</p>
          )}
        </nav>
      </aside>

      <main className="material-panel border-t-0 min-h-0 min-w-0 flex-1 overflow-y-auto md:border-l-0">
        <div
          className={cn(
            'mx-auto w-full px-6 py-10 md:px-10 md:py-14 lg:py-16',
            activeTab.layout === 'manager' ? 'max-w-[960px]' : 'max-w-[720px]',
          )}
        >
          <header className="mb-8">
            <h1 className="text-xl font-semibold tracking-tight">{activeTab.label}</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">{activeTab.description}</p>
          </header>

          <SettingsContent settings={settings} error={error} tab={tab} onChanged={onChanged} />
        </div>
      </main>
    </section>
  )
}

const settingsPanels: Record<
  Exclude<SettingsTab, 'appearance' | 'remote'>,
  ComponentType<{ settings: AgentSettingsSnapshot; onChanged: () => Promise<void> }>
> = { model: ModelSettings, agent: AgentSettings, plugins: PluginSettings }

function SettingsContent({
  settings,
  error,
  tab,
  onChanged,
}: {
  settings: AgentSettingsSnapshot | null
  error: string | null
  tab: SettingsTab
  onChanged: () => Promise<void>
}) {
  if (tab === 'appearance') return <AppearanceSettings />
  if (tab === 'remote') return <RemoteSettings />
  if (error)
    return (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    )
  if (!settings)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        正在读取配置…
      </p>
    )
  const Panel = settingsPanels[tab]
  return <Panel settings={settings} onChanged={onChanged} />
}
