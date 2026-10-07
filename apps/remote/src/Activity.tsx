import { useState } from 'react'
import { CheckIcon, Loader2Icon, ShieldQuestionIcon, XIcon } from 'lucide-react'
import type { RemoteActivity } from '@kklyeenook/shared/remote/index'
import { ToolTimeline } from '@kklyeenook/ui/assistant-ui/tool-timeline'

export function Activity({ activities }: { activities: RemoteActivity[] }) {
  const [open, setOpen] = useState(false)
  if (!activities.length) return null
  const running = activities.some(activity => activity.status === 'running' || activity.status === 'waiting')
  return <section aria-label="Agent Activity" className="px-1 py-2">
    <ToolTimeline open={open} onOpenChange={setOpen} label={<span className="flex items-center gap-2">{running && <Loader2Icon className="size-3.5 animate-spin" />}Agent Activity</span>} trailing={<span className="text-xs text-muted-foreground">{activities.length}</span>}>
      {activities.map(activity => <div key={activity.id} className="flex gap-2 py-2 text-sm">
        {activity.status === 'running' ? <Loader2Icon className="mt-1 size-3.5 shrink-0 animate-spin" /> : activity.status === 'failed' ? <XIcon className="mt-1 size-3.5 shrink-0 text-destructive" /> : activity.status === 'waiting' ? <ShieldQuestionIcon className="mt-1 size-3.5 shrink-0" /> : <CheckIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1"><p>{activity.label} <span className="text-xs text-muted-foreground">· {activity.status}</span></p>{activity.detail && <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{activity.detail}</pre>}</div>
      </div>)}
    </ToolTimeline>
  </section>
}
