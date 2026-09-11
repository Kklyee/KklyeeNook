import { ApprovalPrompt } from '../features/approval/ApprovalPrompt'
import { ChatPanel } from '../features/chat/ChatPanel'
import { ThreadSidebar } from '../features/chat/ThreadSidebar'
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar'

export function AppShell() {
  return (
    <SidebarProvider className="h-full min-h-0 overflow-hidden">
      <ThreadSidebar collapsible="icon"  />
      <SidebarInset className="min-h-0 overflow-hidden">
        <ChatPanel />
      </SidebarInset>
      <ApprovalPrompt />
    </SidebarProvider>
  )
}
