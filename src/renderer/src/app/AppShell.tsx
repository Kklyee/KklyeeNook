import { useState } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { ChatPanel } from '../chat/components/ChatPannel'
import { Approval } from '../chat/approval/Approval'
import { SettingsPage } from '../settings/SettingsPage'
import { useAgentSettings } from '../settings/useAgentSettings'
import { AppSidebar, type AppPage } from './AppSidebar'

export function AppShell() {
  const [page, setPage] = useState<AppPage>('chat')
  const { settings, error } = useAgentSettings()
  const hasMessages = useAuiState((s) => s.thread.messages.length > 0)
  const isRunning = useAuiState((s) => s.thread.isRunning)
  const taskTitle = useAuiState((s) => {
    const firstUser = s.thread.messages.find((message) => message.role === 'user')
    return (
      firstUser?.content
        .flatMap((part) => (part.type === 'text' ? [part.text] : []))
        .join(' ')
        .slice(0, 32) || '当前任务'
    )
  })
  const projectName = settings?.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? '当前项目'

  return (
    <div className="flex h-full min-h-0 flex-col sm:flex-row">
      <AppSidebar
        page={page}
        onNavigate={setPage}
        taskTitle={taskTitle}
        hasMessages={hasMessages}
        projectName={projectName}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-5 text-xs">
          <span className="truncate">
            {page === 'settings' ? '设置' : hasMessages ? taskTitle : '新建任务'}
          </span>
        </header>
        {/* Keep the thread mounted: navigation must not dispose messages or a running stream. */}
        <div hidden={page !== 'chat'} className="min-h-0 flex-1">
          <ChatPanel />
        </div>
        <div hidden={page !== 'settings'} className="min-h-0 flex-1 overflow-y-auto">
          <SettingsPage settings={settings} error={error} />
        </div>
        <footer className="text-muted-foreground flex shrink-0 flex-wrap justify-between gap-2 px-5 py-3 text-xs">
          <span>{settings?.modelID ?? (error ? '配置读取失败' : '读取配置中…')}</span>
          <span role="status">
            {isRunning ? '任务运行中 · 审批请求请及时处理' : '本地会话 · 重启后清空'}
          </span>
        </footer>
        {/* Approval stays available even when the user is viewing settings. */}
        <Approval />
      </div>
    </div>
  )
}
