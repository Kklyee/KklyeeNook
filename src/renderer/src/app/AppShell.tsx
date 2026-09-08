import { ChatPanel } from '../chat/components/ChatPannel'
import { Approval } from '../chat/approval/Approval'
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar'
import { ThreadListSidebar } from '../components/assistant-ui/elements/threadlist-sidebar.aui'

export function AppShell() {
  return (
    <SidebarProvider>
      <ThreadListSidebar collapsible="icon" />
      <SidebarInset>
        <ChatPanel />
      </SidebarInset>
      <Approval />
    </SidebarProvider>
  )
}
