import { Thread } from '../../components/assistant-ui/elements/thread.aui'
import { Approval } from '../approval/Approval'

export function ChatPanel() {
  return (
    <div className="relative h-full w-full">
      <Thread />
      <Approval />
    </div>
  )
}
