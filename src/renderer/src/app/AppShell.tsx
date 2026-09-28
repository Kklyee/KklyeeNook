import { useState } from 'react'
import { useAuiEvent } from '@assistant-ui/react'
import { ChatPanel } from '../features/chat/ChatPanel'
import { ThreadSidebar } from '../features/chat/ThreadSidebar'
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar'
import { SettingsPage } from '../features/settings/SettingsPage'
import { useAgentSettings } from '../features/settings/useAgentSettings'
import { Titlebar } from '../components/Titlebar'
import { AgentRunOverviewProvider } from '../features/runs/AgentRunOverviewProvider'
import { ScheduledTasksPage } from '../features/scheduled-tasks/ScheduledTasksPage'

export function AppShell() {
  const [view, setView] = useState<'chat' | 'settings' | 'scheduled-tasks'>('chat')
  const { settings, error, reload } = useAgentSettings()

  useAuiEvent('threads.selectionChanged', () => setView('chat'))

  return (
    <AgentRunOverviewProvider>
      <div className="flex h-full min-h-0 flex-col">
        <Titlebar />
        <div className="min-h-0 flex-1">
          {view === 'settings' ? (
            <SettingsPage
              settings={settings}
              error={error}
              onClose={() => setView('chat')}
              onChanged={reload}
            />
          ) : view === 'scheduled-tasks' ? (
            <ScheduledTasksPage onClose={() => setView('chat')} />
          ) : (
            <SidebarProvider className="h-full min-h-0 overflow-hidden">
              <ThreadSidebar
                className="app-sidebar"
                collapsible="icon"
                onOpenSettings={() => setView('settings')}
                onOpenScheduledTasks={() => setView('scheduled-tasks')}
              />
              <SidebarInset className="min-h-0 overflow-hidden">
                <ChatPanel settings={settings} onSettingsChanged={reload} />
              </SidebarInset>
            </SidebarProvider>
          )}
        </div>
      </div>
    </AgentRunOverviewProvider>
  )
}
