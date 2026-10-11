import { useChatRuntimeSnapshot } from '../chat/runtime/chat-runtime'
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClockIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/src/components/ui/dialog'
import { Input } from '@/renderer/src/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/src/components/ui/select'
import { Textarea } from '@/renderer/src/components/ui/textarea'
import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskSchedule,
  UpdateScheduledTaskInput,
} from '@kklyeenook/shared/scheduler/scheduled-task'

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

const taskQueryKey = ['scheduled-tasks'] as const

export function ScheduledTasks() {
  const queryClient = useQueryClient()
  const tasksQuery = useQuery({
    queryKey: taskQueryKey,
    queryFn: () => window.api.listScheduledTasks(),
  })
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTask | undefined>()
  const [mutationError, setMutationError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: async ({
      task,
      input,
    }: {
      task?: ScheduledTask
      input: CreateScheduledTaskInput | UpdateScheduledTaskInput
    }) => {
      if (task) return window.api.updateScheduledTask(task.id, input)
      return window.api.createScheduledTask(input as CreateScheduledTaskInput)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKey })
      setEditorOpen(false)
    },
    onError: (error) => setMutationError(error instanceof Error ? error.message : String(error)),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      enabled ? window.api.enableScheduledTask(id) : window.api.disableScheduledTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskQueryKey }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => window.api.deleteScheduledTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskQueryKey }),
  })

  const openCreate = () => {
    setMutationError(null)
    setEditingTask(undefined)
    setEditorOpen(true)
  }

  const openEdit = (task: ScheduledTask) => {
    setMutationError(null)
    setEditingTask(task)
    setEditorOpen(true)
  }

  const saveTask = async (input: CreateScheduledTaskInput | UpdateScheduledTaskInput) => {
    setMutationError(null)
    await saveMutation.mutateAsync({ task: editingTask, input })
  }

  const tasks = tasksQuery.data ?? []

  return (
    <section aria-labelledby="scheduled-tasks-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 id="scheduled-tasks-title" className="text-xs font-medium">
          已配置的定时任务
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">{tasks.length} 个</span>
          <Button size="sm" onClick={openCreate}>
            <PlusIcon />
            新建任务
          </Button>
        </div>
      </div>

      {tasksQuery.error ? (
        <p role="alert" className="text-destructive text-sm">
          {tasksQuery.error instanceof Error ? tasksQuery.error.message : String(tasksQuery.error)}
        </p>
      ) : tasksQuery.isLoading ? (
        <p role="status" className="text-muted-foreground text-sm">
          正在读取定时任务…
        </p>
      ) : tasks.length === 0 ? (
        <div className="material-control rounded-xl border-dashed px-6 py-14 text-center">
          <CalendarClockIcon className="text-muted-foreground/60 mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">暂无定时任务</p>
          <p className="text-muted-foreground mt-1 text-xs">
            创建一个一次性、每天或每周的任务，让 Agent 自动执行提示词。
          </p>
        </div>
      ) : (
        <div className="material-control divide-y divide-border overflow-hidden rounded-xl">
          {tasks.map((task) => (
            <ScheduledTaskRow
              key={task.id}
              task={task}
              busy={toggleMutation.isPending || deleteMutation.isPending}
              onEdit={() => openEdit(task)}
              onToggle={() => toggleMutation.mutate({ id: task.id, enabled: !task.enabled })}
              onDelete={() => {
                if (window.confirm(`删除「${task.title}」？`)) deleteMutation.mutate(task.id)
              }}
            />
          ))}
        </div>
      )}

      {editorOpen && (
        <ScheduledTaskEditor
          key={editingTask?.id ?? 'new'}
          task={editingTask}
          open={editorOpen}
          saving={saveMutation.isPending}
          error={mutationError}
          onOpenChange={setEditorOpen}
          onSave={saveTask}
        />
      )}
    </section>
  )
}

function ScheduledTaskRow({
  task,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: {
  task: ScheduledTask
  busy: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <article className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-medium">{task.title}</h3>
          <span className={task.enabled ? 'text-success text-xs' : 'text-muted-foreground text-xs'}>
            {task.enabled ? '已启用' : '已停用'}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{formatSchedule(task.schedule)}</p>
        <p className="text-muted-foreground mt-1 text-xs">下次执行：{formatNextRun(task)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onToggle} disabled={busy}>
          {task.enabled ? '停用' : '启用'}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          disabled={busy}
          aria-label="编辑任务"
        >
          <PencilIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={busy}
          aria-label="删除任务"
        >
          <Trash2Icon />
        </Button>
      </div>
    </article>
  )
}

function ScheduledTaskEditor({
  task,
  open,
  saving,
  error,
  onOpenChange,
  onSave,
}: {
  task?: ScheduledTask
  open: boolean
  saving: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSave: (input: CreateScheduledTaskInput | UpdateScheduledTaskInput) => Promise<void>
}) {
  const { bots } = useChatRuntimeSnapshot()
  const [form, setForm] = useState<FormState>(() => createFormState(task))
  const [formError, setFormError] = useState<string | null>(null)

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const save = async () => {
    try {
      const schedule = toSchedule(form)
      const skillIds = form.skillIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
      const common = {
        botId: form.botId,
        title: form.title,
        prompt: form.prompt,
        schedule,
        skillIds,
        ...(form.sessionId.trim() ? { sessionId: form.sessionId.trim() } : {}),
      }
      await onSave(task ? { ...common, sessionId: form.sessionId.trim() || null } : common)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? '编辑定时任务' : '新建定时任务'}</DialogTitle>
          <DialogDescription>为 Agent 提示词选择一个简单的执行计划。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="标题">
            <Input value={form.title} onChange={(event) => update('title', event.target.value)} />
          </Field>
          <Field label="提示词">
            <Textarea
              value={form.prompt}
              onChange={(event) => update('prompt', event.target.value)}
              rows={5}
              placeholder="Agent 需要做什么？"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="执行计划">
              <Select
                value={form.type}
                onValueChange={(value) => update('type', value as FormState['type'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">仅一次</SelectItem>
                  <SelectItem value="daily">每天</SelectItem>
                  <SelectItem value="weekly">每周</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.type === 'weekly' ? (
              <Field label="星期">
                <Select
                  value={String(form.weekday)}
                  onValueChange={(value) => update('weekday', Number(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((weekday) => (
                      <SelectItem key={weekday.value} value={String(weekday.value)}>
                        {weekday.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Field label={form.type === 'once' ? '执行时间' : '时间'}>
                <Input
                  type={form.type === 'once' ? 'datetime-local' : 'time'}
                  value={form.type === 'once' ? form.runAt : form.time}
                  onChange={(event) =>
                    update(form.type === 'once' ? 'runAt' : 'time', event.target.value)
                  }
                />
              </Field>
            )}
          </div>
          {form.type === 'weekly' && (
            <Field label="时间">
              <Input
                type="time"
                value={form.time}
                onChange={(event) => update('time', event.target.value)}
              />
            </Field>
          )}
          <Field label="技能 ID">
            <Input
              value={form.skillIds}
              onChange={(event) => update('skillIds', event.target.value)}
              placeholder="可选，使用英文逗号分隔"
            />
          </Field>
          <Field label="Bot">
            <Select
              value={form.botId}
              onValueChange={(value) => {
                if (value) update('botId', value)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bots.map((bot) => (
                  <SelectItem key={bot.id} value={bot.id}>
                    {bot.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="会话 ID">
            <Input
              value={form.sessionId}
              onChange={(event) => update('sessionId', event.target.value)}
              placeholder="可选，复用已有会话"
            />
          </Field>
          {(error ?? formError) && (
            <p role="alert" className="text-destructive text-sm">
              {error ?? formError}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? '正在保存…' : '保存任务'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  )
}

type FormState = {
  title: string
  prompt: string
  type: ScheduledTaskSchedule['type']
  runAt: string
  time: string
  weekday: number
  skillIds: string
  botId: string
  sessionId: string
}

function createFormState(task?: ScheduledTask): FormState {
  if (!task) {
    return {
      title: '',
      prompt: '',
      type: 'once',
      runAt: toDateTimeLocal(Date.now() + 60 * 60 * 1_000),
      time: '09:00',
      weekday: 1,
      skillIds: '',
      botId: 'xiaoya',
      sessionId: '',
    }
  }

  return {
    title: task.title,
    prompt: task.prompt,
    type: task.schedule.type,
    runAt:
      task.schedule.type === 'once'
        ? toDateTimeLocal(task.schedule.runAt)
        : toDateTimeLocal(Date.now()),
    time: task.schedule.type === 'once' ? '09:00' : task.schedule.time,
    weekday: task.schedule.type === 'weekly' ? task.schedule.weekday : 1,
    skillIds: task.skillIds?.join(', ') ?? '',
    botId: task.botId ?? 'xiaoya',
    sessionId: task.sessionId ?? '',
  }
}

function toSchedule(form: FormState): ScheduledTaskSchedule {
  if (form.type === 'once') {
    const runAt = new Date(form.runAt).getTime()
    if (!Number.isFinite(runAt)) throw new Error('请选择有效的执行时间')
    return { type: 'once', runAt }
  }
  if (form.type === 'daily') return { type: 'daily', time: form.time }
  return { type: 'weekly', weekday: form.weekday, time: form.time }
}

function formatSchedule(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === 'once') return `仅一次 · ${formatDate(schedule.runAt)}`
  if (schedule.type === 'daily') return `每天 · ${schedule.time}`
  return `每周${WEEKDAYS[schedule.weekday]?.label ?? ''} · ${schedule.time}`
}

function formatNextRun(task: ScheduledTask): string {
  if (!task.enabled || task.nextRunAt === undefined) return '暂无计划'
  const date = new Date(task.nextRunAt)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (sameDate(date, today)) return `今天 ${time}`
  if (sameDate(date, tomorrow)) return `明天 ${time}`
  return formatDate(task.nextRunAt)
}

function formatDate(value: number): string {
  return dateFormatter.format(value)
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function sameDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function toDateTimeLocal(value: number): string {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
