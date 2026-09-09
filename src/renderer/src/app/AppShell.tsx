import { ApprovalPrompt } from '../features/approval/ApprovalPrompt'
import { ChatPanel } from '../features/chat/ChatPanel'
import { ThreadSidebar } from '../features/chat/ThreadSidebar'
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar'

export function AppShell() {
  return (
    <SidebarProvider>
      <ThreadSidebar collapsible="icon" />
      <SidebarInset>
        <ChatPanel />
      </SidebarInset>
      <ApprovalPrompt />
    </SidebarProvider>
  )
}
