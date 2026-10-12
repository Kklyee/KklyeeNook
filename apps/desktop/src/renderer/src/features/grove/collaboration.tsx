import { useEffect, useState } from 'react'
import type { BotTask } from '@kklyeenook/shared/bot/grove'
import type { NetworkBotIdentity } from '@kklyeenook/shared/bot/social'
import { useChatRuntimeSnapshot, useChatStore } from '../chat/runtime/chat-runtime'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Select, SelectTrigger, SelectContent, SelectItem } from '../../components/ui/select'

const labels: Record<BotTask['status'], string> = {
  pending: '待投递',
  accepted: '已接收 · 排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  rejected: '已拒绝',
}

export function Collaboration() {
  const store = useChatStore()
  const { bots, selectedBotId, selectedThreadId } = useChatRuntimeSnapshot()
  const [tasks, setTasks] = useState<BotTask[]>([])
  const [contacts, setContacts] = useState<NetworkBotIdentity[]>([])
  const [target, setTarget] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [operation, setOperation] = useState(() => crypto.randomUUID())
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const state = await store.grove()
        if (active) {
          setTasks(state.tasks)
          setContacts(state.contacts ?? [])
          setError('')
        }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '协作状态加载失败')
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [store])
  const names = (id: string) =>
    bots.find((bot) => bot.id === id)?.name ??
    contacts.find((bot) => bot.networkId === id)?.name ??
    id
  const visible = tasks.slice().reverse()
  return (
    <details className="p-5" open>
      <summary className="cursor-pointer font-medium">
        Bot 协作
      </summary>
      <div className="mt-4 flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          发起 Bot：{selectedBotId ? names(selectedBotId) : '请先在 Chat 选择 Bot'}。目标 Bot
          使用自己的模型和资源权限。远程任务需要接收方授权。
        </p>
        <Select
          value={target}
          onValueChange={(value) => {
            if (value) {
              setTarget(value)
              setOperation(crypto.randomUUID())
            }
          }}
        >
          <SelectTrigger aria-label="协作目标">
            {target ? names(target) : '选择协作 Bot'}
          </SelectTrigger>
          <SelectContent>
            {contacts.map((bot) => (
              <SelectItem key={bot.networkId} value={bot.networkId}>
                {bot.name} · {bot.ownerUserId}
              </SelectItem>
            ))}
            {bots
              .filter((bot) => bot.id !== selectedBotId)
              .map((bot) => (
                <SelectItem key={bot.id} value={bot.id}>
                  {bot.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Textarea
          aria-label="协作任务或消息"
          placeholder="描述任务，或发送一条普通消息…"
          value={content}
          onChange={(event) => {
            setContent(event.target.value)
            setOperation(crypto.randomUUID())
          }}
        />
        <div className="flex gap-2">
          {(['tasks', 'messages'] as const).map((type) => (
            <Button
              key={type}
              size="sm"
              variant={type === 'tasks' ? 'default' : 'outline'}
              disabled={sending || !target || !content.trim() || !selectedThreadId}
              onClick={async () => {
                setSending(true)
                setError('')
                try {
                  await store.collaborate(target, content, type, operation)
                  setContent('')
                  setOperation(crypto.randomUUID())
                  setTasks((await store.grove()).tasks)
                } catch (error) {
                  setError(error instanceof Error ? error.message : '发送失败')
                } finally {
                  setSending(false)
                }
              }}
            >
              {type === 'tasks' ? '请求协作' : '发送消息'}
            </Button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="divide-y">
          {visible.map((task) => (
            <details key={task.id} className="py-3">
              <summary className="cursor-pointer text-sm">
                {names(task.fromBotId)} → {names(task.toBotId)}{' '}
                <span className="text-xs text-muted-foreground">· {labels[task.status]}</span>
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm">{task.instruction}</p>
              {task.result && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {task.result}
                </p>
              )}
            </details>
          ))}
        </div>
      </div>
    </details>
  )
}
