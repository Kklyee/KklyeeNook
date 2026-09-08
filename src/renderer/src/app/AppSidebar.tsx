import { Settings2, SquarePen } from 'lucide-react'
import { Button } from '../components/ui/button'
import { ThreadList } from '../components/assistant-ui/elements/thread-list'

export type AppPage = 'chat' | 'settings'

export function AppSidebar({
  page,
  onNavigate,
  taskTitle,
  hasMessages,
}: {
  page: AppPage
  onNavigate: (page: AppPage) => void
  taskTitle: string
  hasMessages: boolean
  projectName: string
}) {
  return (
    <aside className="bg-sidebar flex shrink-0 flex-wrap gap-2 border-b p-3 sm:w-48 sm:flex-col sm:border-r sm:border-b-0">
      <Button
        variant="ghost"
        className="justify-start"
        disabled={hasMessages}
        onClick={() => onNavigate('chat')}
        aria-describedby="single-task-note"
      >
        <SquarePen />
        新建任务
      </Button>

      <ThreadList
        threads={[{ title: taskTitle, time: '' }]}
        activeIndex={page === 'chat' ? 0 : -1}
        onActiveIndexChange={() => onNavigate('chat')}
      />

      <Button
        variant={page === 'settings' ? 'secondary' : 'ghost'}
        className="justify-start sm:mt-auto"
        aria-current={page === 'settings' ? 'page' : undefined}
        onClick={() => onNavigate('settings')}
      >
        <Settings2 />
        设置
      </Button>
    </aside>
  )
}
