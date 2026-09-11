import { useState, type ComponentType, type ReactNode } from 'react'
import {
  ArrowLeftIcon,
  BotIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'

const toolDescriptions: Record<string, string> = {
  read: '读取文件',
  edit: '编辑文件',
  write: '写入文件',
  bash: '执行命令',
}

type SettingsTab = 'model' | 'tools' | 'permissions'

const settingsTabs: Array<{
  id: SettingsTab
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: 'model', label: '模型配置', description: '模型与工作目录', icon: BotIcon },
  { id: 'tools', label: '工具', description: '可用工具与审批方式', icon: WrenchIcon },
  { id: 'permissions', label: '权限管理', description: '查看和撤销授权', icon: ShieldCheckIcon },
]

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
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const permissionGrants = Array.isArray(settings?.permissionGrants)
    ? settings.permissionGrants
    : []
  const visibleTabs = settingsTabs.filter(({ label, description }) =>
    `${label}${description}`.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const activeTab = settingsTabs.find((item) => item.id === tab) ?? settingsTabs[0]

  const revoke = async (id: string) => {
    setRevoking(id)
    setRevokeError(null)
    try {
      await window.api.deletePermissionGrant({ id })
      await onChanged()
    } catch {
      setRevokeError('权限撤销失败，请重试。')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <section
      className="bg-background flex h-full min-h-0 w-full flex-col md:flex-row"
      aria-label="设置"
    >
      <aside className="bg-sidebar text-sidebar-foreground flex w-full shrink-0 flex-col border-b md:h-full md:w-60 md:border-r md:border-b-0">
        <div className="px-3 pt-3 pb-2">
          <Button
            variant="ghost"
            className="h-8 justify-start gap-2 px-2 text-xs font-normal"
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
              className="bg-foreground/[0.04] h-8 border-transparent pl-8 text-xs shadow-none focus-visible:bg-background"
            />
          </div>
        </div>

        <nav aria-label="设置分类" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] font-medium">AGENT</p>
          <div className="space-y-0.5">
            {visibleTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? 'page' : undefined}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring',
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
          {visibleTabs.length === 0 && (
            <p className="text-muted-foreground px-2 py-4 text-xs">没有匹配的设置</p>
          )}
        </nav>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-14 lg:py-16">
          <header className="mb-8">
            <p className="text-muted-foreground mb-2 text-xs">设置</p>
            <h1 className="text-xl font-semibold tracking-tight">{activeTab.label}</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">{activeTab.description}</p>
          </header>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : !settings ? (
            <p role="status" className="text-muted-foreground text-sm">
              正在读取配置…
            </p>
          ) : tab === 'model' ? (
            <ModelSettings settings={settings} />
          ) : tab === 'tools' ? (
            <ToolSettings settings={settings} />
          ) : (
            <PermissionSettings
              settings={settings}
              permissionGrants={permissionGrants}
              revoking={revoking}
              revokeError={revokeError}
              onRevoke={revoke}
            />
          )}
        </div>
      </main>
    </section>
  )
}

function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="bg-card divide-y overflow-hidden rounded-xl border">{children}</div>
}

function SettingRow({
  label,
  description,
  value,
}: {
  label: string
  description: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
      </div>
      <span className="text-muted-foreground max-w-full shrink-0 break-all text-xs sm:max-w-[55%] sm:text-right">
        {value}
      </span>
    </div>
  )
}

function ModelSettings({ settings }: { settings: AgentSettingsSnapshot }) {
  return (
    <section aria-labelledby="model-section-title">
      <h2 id="model-section-title" className="mb-3 text-xs font-medium">
        常规
      </h2>
      <SettingsCard>
        <SettingRow label="供应商" description="当前模型服务提供方" value={settings.provider} />
        <SettingRow label="模型" description="用于处理新任务的模型" value={settings.modelID} />
        <SettingRow label="思考级别" description="模型的推理强度" value={settings.thinkingLevel} />
        <SettingRow
          label="API Key"
          description="密钥只保存在主进程，不会在这里显示"
          value={settings.hasApiKey ? '已配置' : '未配置'}
        />
        <SettingRow label="工作目录" description="Agent 默认操作的项目目录" value={settings.cwd} />
        <SettingRow
          label="会话存储"
          description="当前会话数据的保存方式"
          value="仅内存，重启后清空"
        />
      </SettingsCard>
      <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
        模型配置当前为只读。通过启动配置设置模型，通过 .env 设置 API_KEY，修改后需重启。
      </p>
    </section>
  )
}

function ToolSettings({ settings }: { settings: AgentSettingsSnapshot }) {
  return (
    <section aria-labelledby="tools-section-title">
      <h2 id="tools-section-title" className="mb-3 text-xs font-medium">
        已启用的工具
      </h2>
      <SettingsCard>
        {settings.tools.map((tool) => (
          <SettingRow
            key={tool.name}
            label={toolDescriptions[tool.name] ?? tool.name}
            description={tool.name}
            value={tool.requiresApproval ? '按权限策略' : '无需审批'}
          />
        ))}
      </SettingsCard>
      <p className="text-muted-foreground mt-4 text-xs">
        受保护的工具在没有匹配 Permission Grant 时会请求审批。
      </p>
    </section>
  )
}

function PermissionSettings({
  settings,
  permissionGrants,
  revoking,
  revokeError,
  onRevoke,
}: {
  settings: AgentSettingsSnapshot
  permissionGrants: AgentSettingsSnapshot['permissionGrants']
  revoking: string | null
  revokeError: string | null
  onRevoke: (id: string) => Promise<void>
}) {
  return (
    <>
      <section aria-labelledby="default-permission-policy">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 id="default-permission-policy" className="text-xs font-medium">
            默认策略
          </h2>
          <span className="text-muted-foreground text-xs">
            {settings.tools.filter((tool) => tool.requiresApproval).length} 个受保护工具
          </span>
        </div>
        <SettingsCard>
          {settings.tools.map((tool) => (
            <SettingRow
              key={tool.name}
              label={toolDescriptions[tool.name] ?? tool.name}
              description={tool.name}
              value={tool.requiresApproval ? '未授权时询问' : '直接允许'}
            />
          ))}
        </SettingsCard>
      </section>

      <div className="bg-foreground/[0.025] mt-5 flex items-start gap-3 rounded-xl border p-4">
        <ShieldCheckIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <p className="text-muted-foreground text-xs leading-relaxed">
          Session 权限只匹配对应 Agent Session；Always 权限跨 Session
          生效。撤销后，下一次匹配调用会重新询问。
        </p>
      </div>

      <div className="mt-8 mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xs font-medium">已保存的 Grant</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            在审批卡中选择 This session 或 Always 后会显示在这里。
          </p>
        </div>
        <span className="text-muted-foreground text-xs">{permissionGrants.length} 条</span>
      </div>
      {revokeError && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {revokeError}
        </p>
      )}
      {permissionGrants.length === 0 ? (
        <div className="rounded-xl border border-dashed px-5 py-9 text-center">
          <ShieldCheckIcon className="text-muted-foreground/60 mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">尚无已保存的权限</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-xs leading-relaxed">
            返回对话并触发读取、写入或命令工具；审批出现时选择 This session 或
            Always，即可创建第一条 Grant。
          </p>
        </div>
      ) : (
        <SettingsCard>
          {permissionGrants.map((grant) => (
            <div key={grant.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{grant.permission.description}</span>
                  <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-[10px] uppercase">
                    {grant.duration}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 break-all font-mono text-xs">
                  {grant.permission.action} · {grant.permission.resource}
                </p>
                {grant.sessionId && (
                  <p className="text-muted-foreground mt-1 truncate text-[11px]">
                    Session: {grant.sessionId}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="撤销权限"
                title="撤销权限"
                disabled={revoking === grant.id}
                onClick={() => void onRevoke(grant.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </SettingsCard>
      )}
    </>
  )
}
