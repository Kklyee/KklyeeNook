import { useState } from 'react'
import { useChatRuntimeExtras } from './runtime/chat-runtime'
import {
  MessageQueue,
  type QueuedMessage,
} from '@/renderer/src/components/assistant-ui/elements/message-queue'
import type { AgentQueueMutation } from '@/shared/agent/chat-protocol'

export function QueuedMessages() {
  const { queue, clearQueue, refresh, updateQueue } = useChatRuntimeExtras()
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string>()
  const clear = async () => {
    setClearing(true)
    setError(undefined)
    try {
      await clearQueue()
      await refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : '清空失败，请重试')
    } finally {
      setClearing(false)
    }
  }
  const mutate = async (
    message: QueuedMessage,
    action: Pick<AgentQueueMutation, 'action'> & { value?: string | number },
  ) => {
    setClearing(true)
    setError(undefined)
    try {
      await updateQueue({
        mode: message.steer ? 'steer' : 'followUp',
        expected: message.expected,
        index: message.index,
        ...action,
      } as AgentQueueMutation)
      await refresh()
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败，请重试')
      await refresh().catch(() => undefined)
      return false
    } finally {
      setClearing(false)
    }
  }
  const messages = [
    ...queue.steering.map((text, index) => ({
      id: `steer:${index}`,
      text,
      steer: true,
      index,
      expected: [...queue.steering],
    })),
    ...queue.followUp.map((text, index) => ({
      id: `followUp:${index}`,
      text,
      steer: false,
      index,
      expected: [...queue.followUp],
    })),
  ]
  return (
    <MessageQueue
      queued={messages}
      onClear={() => void clear()}
      onRemove={(message) => void mutate(message, { action: 'remove' })}
      onSteer={(message) => void mutate(message, { action: 'steer' })}
      onEdit={(message, text) => mutate(message, { action: 'edit', value: text })}
      onMove={(message, offset) =>
        void mutate(message, { action: 'move', value: message.index + offset })
      }
      clearing={clearing}
      error={error}
    />
  )
}
