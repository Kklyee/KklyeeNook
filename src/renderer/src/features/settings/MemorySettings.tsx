import { useEffect, useState } from 'react'
import { BrainIcon, Trash2Icon } from 'lucide-react'
import type { AgentMemory } from '@/shared/memory/agentMemory'
import { useWorkspaces } from '../workspaces/WorkspaceProvider'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/select'
import { Button } from '../../components/ui/button'
import { SettingsCard } from './SettingsComponents'

export function MemorySettings() {
  const { workspaces } = useWorkspaces()
  const [workspaceId, setWorkspaceId] = useState<string>('global')

  return (
    <section aria-labelledby="memory-section-title">
      <Select
        value={workspaceId}
        onValueChange={(value) => {
          if (value) setWorkspaceId(value)
        }}
      >
        <SelectTrigger className="mb-4">
          {workspaceId === 'global'
            ? '全局 Memory'
            : workspaces.find((item) => item.id === workspaceId)?.displayName}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="global">全局 Memory</SelectItem>
          {workspaces.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <MemoryList key={workspaceId} workspaceId={workspaceId} />
    </section>
  )
}

function MemoryList({ workspaceId }: { workspaceId: string }) {
  const [memories, setMemories] = useState<AgentMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.api.listMemories(workspaceId === 'global' ? undefined : workspaceId).then(
      (items) => {
        if (!active) return
        setMemories(items)
        setLoading(false)
      },
      (loadError) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Memory 读取失败，请重试。')
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [workspaceId])

  const removeMemory = async (id: string) => {
    setDeleting(id)
    setError(null)
    try {
      await window.api.deleteMemory({ id })
      setMemories((current) => current.filter((memory) => memory.id !== id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Memory 删除失败，请重试。')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="memory-section-title" className="text-xs font-medium">
            已保存的 Memory
          </h2>
        </div>
        <span className="text-muted-foreground text-xs">{memories.length} 条</span>
      </div>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          正在读取 Memory…
        </p>
      ) : memories.length === 0 ? (
        <div className="glass-surface rounded-xl border-dashed px-5 py-9 text-center">
          <BrainIcon className="text-muted-foreground/60 mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">暂无已保存的 Memory</p>
          <p className="text-muted-foreground mt-1 text-xs">保存的长期记忆会显示在这里。</p>
        </div>
      ) : (
        <SettingsCard>
          {memories.map((memory) => (
            <div key={memory.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-[10px]">
                    {memory.scope === 'global' ? '全局' : '当前 Workspace'}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    更新于 {formatMemoryTime(memory.updatedAt)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{memory.content}</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="删除 Memory"
                title="删除 Memory"
                disabled={deleting === memory.id}
                onClick={() => void removeMemory(memory.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </SettingsCard>
      )}
    </>
  )
}

const memoryTimeFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

function formatMemoryTime(timestamp: number): string {
  return memoryTimeFormatter.format(timestamp)
}
