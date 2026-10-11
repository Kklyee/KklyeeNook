import { useState } from 'react'
import { useAuiEvent } from '@assistant-ui/react'
import { ChatPanel } from '../features/chat/chat-panel'
import { ThreadSidebar } from '../features/chat/ThreadSidebar'
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar'
import { SettingsPage } from '../features/settings/SettingsPage'
import { useAgentSettings } from '../features/settings/useAgentSettings'
import { Titlebar } from '../components/Titlebar'
import { AgentRunOverviewProvider } from '../features/runs/AgentRunOverviewProvider'
import { AppRail } from './app-rail'
import type { AppView } from './navigation'
import { HomePage } from '../features/home/HomePage'
import { TasksPage } from '../features/tasks/TasksPage'
import { MemoriesPage } from '../features/memories/MemoriesPage'
import { GrovePage } from '../features/grove/GrovePage'

export function AppShell() {
  const [view, setView] = useState<AppView>('chat')
  const { settings, error, reload } = useAgentSettings()

  useAuiEvent('threads.selectionChanged', () => setView('chat'))

  return (
    <AgentRunOverviewProvider>
      <SidebarProvider className="h-full min-h-0 w-full flex-col overflow-hidden">
        <Titlebar showSidebarToggle={view === 'chat'} onOpenSettings={() => setView('settings')} />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppRail view={view} onNavigate={setView} />
          <div className="min-h-0 min-w-0 flex-1">
            {view === 'chat' ? (
              <div className="flex h-full min-h-0 overflow-hidden">
                <ThreadSidebar className="app-sidebar" collapsible="icon" />
                <SidebarInset className="min-h-0 overflow-hidden">
                  <ChatPanel settings={settings} onSettingsChanged={reload} />
                </SidebarInset>
              </div>
            ) : view === 'settings' ? (
              <SettingsPage settings={settings} error={error} onChanged={reload} />
            ) : view === 'home' ? (
              <HomePage />
            ) : view === 'tasks' ? (
              <TasksPage />
            ) : view === 'memories' ? (
              <MemoriesPage />
            ) : (
              <GrovePage />
            )}
          </div>
        </div>
      </SidebarProvider>
    </AgentRunOverviewProvider>
  )
}
