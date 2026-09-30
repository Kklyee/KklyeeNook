import { useWorkspaces } from '../workspaces/WorkspaceProvider'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/select'
import { useEffect, useState, type DragEvent } from 'react'
import {
  BookOpenIcon,
  FilePlusIcon,
  FolderPlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import {
  DEFAULT_KNOWLEDGE_SETTINGS,
  knowledgeCitationLabel,
  type KnowledgeSearchResult,
  type KnowledgeSource,
} from '@/shared/knowledge/knowledge'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { KnowledgeCitationLink } from '../knowledge/KnowledgeCitationLink'

const statuses = { pending: '等待索引', indexing: '正在索引', ready: 'Ready', error: '索引失败' }

export function KnowledgeSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  const { workspaces } = useWorkspaces()
  const [scopeId, setScopeId] = useState('global')
  const workspaceId = scopeId === 'global' ? undefined : scopeId
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [models, setModels] = useState(settings.knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<KnowledgeSearchResult[] | null>(null)

  const refresh = async () => {
    setSources(await window.api.knowledge.list())
  }
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const next = await window.api.knowledge.list()
        if (active) setSources(next)
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '来源读取失败')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Knowledge 操作失败')
    } finally {
      setBusy(false)
    }
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const files = [...event.dataTransfer.files]
    void act(async () => {
      for (const file of files)
        await window.api.knowledge.add(window.api.knowledge.droppedFilePath(file), 'file', workspaceId)
    })
  }
  const search = async () => {
    setSearching(true)
    setError(null)
    try {
      setResults(await window.api.knowledge.search({ query, workspaceId }))
    } catch (error) {
      setError(error instanceof Error ? error.message : '检索失败')
    } finally {
      setSearching(false)
    }
  }
  const indexing = sources.some(
    (source) => source.status === 'pending' || source.status === 'indexing',
  )

  return (
    <section aria-label="Knowledge 设置" className="space-y-6">
      <Select value={scopeId} onValueChange={value => { if (value) { setScopeId(value); setResults(null) } }}>
        <SelectTrigger>{scopeId === 'global' ? 'Global Knowledge' : workspaces.find(item => item.id === scopeId)?.displayName}</SelectTrigger>
        <SelectContent><SelectItem value="global">Global Knowledge</SelectItem>{workspaces.filter(item => item.status === 'attached').map(item => <SelectItem key={item.id} value={item.id}>{item.displayName}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void act(() => window.api.knowledge.pick('file', workspaceId))}>
          <FilePlusIcon />
          添加文档
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void act(() => window.api.knowledge.pick('folder', workspaceId))}
        >
          <FolderPlusIcon />
          添加文件夹
        </Button>
        <Button
          variant="outline"
          disabled={busy || !workspaceId}
          onClick={() => void act(() => window.api.knowledge.pick('workspace', workspaceId))}
        >
          添加当前 Workspace
        </Button>
      </div>
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={busy ? (event) => event.preventDefault() : drop}
        className={`rounded-xl border border-dashed px-5 py-8 text-center ${dragging ? 'border-primary bg-primary/5' : ''}`}
      >
        <UploadIcon className="text-muted-foreground mx-auto size-5" />
        <p className="mt-2 text-sm font-medium">拖入文档即可建立知识索引</p>
        <p className="text-muted-foreground mt-1 text-xs">
          PDF · DOCX · PPTX · XLSX · Markdown · TXT · HTML · 源代码
        </p>
      </div>
      {error && (
        <p role="alert" className="text-destructive whitespace-pre-wrap text-sm">
          {error}
        </p>
      )}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium">Sources</h2>
          <span className="text-muted-foreground text-xs">
            {sources.reduce((sum, source) => sum + source.documentCount, 0)} documents ·{' '}
            {sources.reduce((sum, source) => sum + source.chunkCount, 0)} chunks
          </span>
        </div>
        {loading ? (
          <p role="status" className="text-muted-foreground text-sm">
            正在读取…
          </p>
        ) : !sources.length ? (
          <div className="bg-card rounded-xl border p-5 text-center">
            <BookOpenIcon className="text-muted-foreground mx-auto size-5" />
            <p className="mt-2 text-sm">添加知识后，Agent 可以检索文档和代码并引用来源。</p>
          </div>
        ) : (
          <div className="bg-card divide-y rounded-xl border">
            {sources.filter(source => (source.workspaceId ?? null) === (workspaceId ?? null)).map((source) => (
              <div key={source.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{source.name}</p>
                    <p className="text-muted-foreground mt-1 break-all text-xs">{source.path}</p>
                  </div>
                  <span
                    role="status"
                    className={`shrink-0 rounded-full px-2 py-1 text-xs ${source.status === 'error' ? 'bg-destructive/10 text-destructive' : source.status === 'ready' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}
                  >
                    {statuses[source.status]}
                  </span>
                </div>
                <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>
                    {source.documentCount} documents · {source.chunkCount} chunks
                  </span>
                  <span>
                    最近索引：
                    {source.lastIndexed
                      ? new Intl.DateTimeFormat('zh-CN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }).format(source.lastIndexed)
                      : '尚未索引'}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 break-all text-xs">
                  Embedding：{source.embeddingModel ?? models.embeddingModel}
                </p>
                {source.error && (
                  <p
                    role="alert"
                    className="text-destructive mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs"
                  >
                    {source.error}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || indexing}
                    onClick={() => void act(() => window.api.knowledge.reindex(source.id))}
                  >
                    <RefreshCwIcon />
                    重新索引
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || indexing}
                    onClick={() => void act(() => window.api.knowledge.remove(source.id))}
                  >
                    <Trash2Icon />
                    移除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          文件变化每 30 秒同步。移除来源仅删除索引，原文件会保留。
        </p>
      </div>
      <div>
        <h2 className="mb-3 text-xs font-medium">试搜知识</h2>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <Input
            aria-label="Knowledge 查询"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Agent Backend 为什么使用独立进程？"
          />
          <Button type="submit" disabled={searching || !query.trim()}>
            {searching ? '检索中…' : '搜索'}
          </Button>
        </form>
        {results && (
          <div className="mt-3 space-y-3">
            {results.length ? (
              results.map(({ chunk }) => (
                <div key={chunk.id} className="bg-card rounded-xl border p-4">
                  <KnowledgeCitationLink
                    chunkId={chunk.id}
                    href="#"
                    className="text-primary text-sm font-medium underline underline-offset-2"
                  >
                    {knowledgeCitationLabel(chunk.citation)}
                  </KnowledgeCitationLink>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {chunk.citation.sourceName}
                    {chunk.citation.heading ? ` · ${chunk.citation.heading}` : ''}
                  </p>
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm">{chunk.content}</p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">没有检索结果。</p>
            )}
          </div>
        )}
      </div>
      <details className="bg-card rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-medium">本地检索模型</summary>
        <p className="text-muted-foreground mt-2 text-xs">
          首次使用会下载模型，之后复用本地缓存。更改 Embedding 模型后需要重新索引。
        </p>
        <div className="mt-3 space-y-3">
          <label className="block text-xs">
            Embedding 模型
            <Input
              className="mt-1"
              value={models.embeddingModel}
              onChange={(event) =>
                setModels((current) => ({ ...current, embeddingModel: event.target.value }))
              }
            />
          </label>
          <label className="block text-xs">
            Rerank 模型
            <Input
              className="mt-1"
              value={models.rerankModel}
              onChange={(event) =>
                setModels((current) => ({ ...current, rerankModel: event.target.value }))
              }
            />
          </label>
          <Button
            variant="outline"
            disabled={
              busy || indexing || !models.embeddingModel.trim() || !models.rerankModel.trim()
            }
            onClick={() =>
              void act(async () => {
                await window.api.updateAgentSettings({ knowledge: models })
                await onChanged()
              })
            }
          >
            保存模型设置
          </Button>
        </div>
      </details>
    </section>
  )
}
