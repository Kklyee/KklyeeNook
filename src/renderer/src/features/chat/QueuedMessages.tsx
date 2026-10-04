import { useState } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { isPiSteerQueueItemId, usePiRuntimeExtras } from '@assistant-ui/react-pi'
import { MessageQueue } from '@/renderer/src/components/assistant-ui/elements/message-queue'

export function QueuedMessages() {
  const queue = useAuiState((state) => state.composer.queue)
  const { clearQueue } = usePiRuntimeExtras()
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string>()
  const clear = async () => {
    setClearing(true)
    setError(undefined)
    try {
      await clearQueue()
    } catch (error) {
      setError(error instanceof Error ? error.message : '清空失败，请重试')
    } finally {
      setClearing(false)
    }
  }
  return (
    <MessageQueue
      queued={queue.map((item) => ({
        id: item.id,
        text: item.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n'),
        steer: isPiSteerQueueItemId(item.id),
      }))}
      onClear={() => void clear()}
      clearing={clearing}
      error={error}
    />
  )
}
