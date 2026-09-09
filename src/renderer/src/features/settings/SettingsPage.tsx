import { useState } from 'react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { Button } from '../../components/ui/button'

const toolDescriptions: Record<string, string> = {
  read: '读取文件',
  edit: '编辑文件',
  write: '写入文件',
  bash: '执行命令',
}

export function SettingsPage({
  settings,
  error,
}: {
  settings: AgentSettingsSnapshot | null
  error: string | null
}) {
  const [tab, setTab] = useState<'model' | 'tools'>('model')

  return (
    <section className="mx-auto w-full max-w-2xl p-5 md:p-10" aria-label="设置">
      <h1 className="text-xl font-medium">设置</h1>
      <p className="text-muted-foreground mt-2 text-sm">当前 Agent 配置 · 只读</p>
      <nav aria-label="设置分类" className="mt-7 flex gap-2 border-b pb-3">
        <Button
          variant={tab === 'model' ? 'secondary' : 'ghost'}
          aria-pressed={tab === 'model'}
          onClick={() => setTab('model')}
        >
          模型
        </Button>
        <Button
          variant={tab === 'tools' ? 'secondary' : 'ghost'}
          aria-pressed={tab === 'tools'}
          onClick={() => setTab('tools')}
        >
          工具与权限
        </Button>
      </nav>
      {error ? (
        <p role="alert" className="text-destructive mt-6 text-sm">
          {error}
        </p>
      ) : !settings ? (
        <p role="status" className="text-muted-foreground mt-6 text-sm">
          正在读取配置…
        </p>
      ) : tab === 'model' ? (
        <>
          <dl className="divide-y">
            {[
              ['供应商', settings.provider],
              ['模型', settings.modelID],
              ['思考级别', settings.thinkingLevel],
              ['API Key', settings.hasApiKey ? '已配置（不显示密钥）' : '未配置'],
              ['工作目录', settings.cwd],
              ['会话存储', '仅内存，重启后清空'],
            ].map(([label, value]) => (
              <div
                key={label}
                className="grid gap-2 py-5 text-sm sm:grid-cols-[110px_minmax(0,1fr)]"
              >
                <dt>{label}</dt>
                <dd className="text-muted-foreground break-all sm:text-right">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-5 text-xs leading-relaxed">
            这一阶段通过启动配置设置模型，通过 .env 设置
            API_KEY，修改后需重启。配置编辑、保存和连接测试尚未接入。
          </p>
        </>
      ) : (
        <>
          <ul className="divide-y">
            {settings.tools.map((tool) => (
              <li
                key={tool.name}
                className="flex flex-wrap items-center justify-between gap-3 py-5 text-sm"
              >
                <div>
                  {toolDescriptions[tool.name] ?? tool.name}
                  <code className="text-muted-foreground ml-2 text-xs">{tool.name}</code>
                </div>
                <span className="text-muted-foreground text-xs">
                  {tool.requiresApproval ? '每次询问' : '无需审批'}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-5 text-xs">
            这里只展示已启用的工具。权限由主进程执行，审批请求会显示在应用中。
          </p>
        </>
      )}
    </section>
  )
}
