import { useState } from 'react'
import { useAuiEvent } from '@assistant-ui/react'
import { ChatPanel } from '../features/chat/ChatPanel'
import { ThreadSidebar } from '../features/chat/ThreadSidebar'
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar'
import { SettingsPage } from '../features/settings/SettingsPage'
import { useAgentSettings } from '../features/settings/useAgentSettings'

export function AppShell() {
  const [view, setView] = useState<'chat' | 'settings'>('chat')
  const { settings, error, reload } = useAgentSettings()

  useAuiEvent('threads.selectionChanged', () => setView('chat'))

  return (
    <>
      {view === 'settings' ? (
        <SettingsPage
          settings={settings}
          error={error}
          onClose={() => setView('chat')}
          onChanged={reload}
        />
      ) : (
        <SidebarProvider className="h-full min-h-0 overflow-hidden">
          <ThreadSidebar collapsible="icon" onOpenSettings={() => setView('settings')} />
          <SidebarInset className="min-h-0 overflow-hidden">
            <ChatPanel settings={settings} />
          </SidebarInset>
        </SidebarProvider>
      )}
    </>
  )
}
