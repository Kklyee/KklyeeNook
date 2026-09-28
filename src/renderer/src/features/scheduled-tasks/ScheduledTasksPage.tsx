import { useEffect, useState, type ReactNode } from 'react'
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
} from '@/shared/scheduler/scheduledTask'

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

export function ScheduledTasksPage({ onClose }: { onClose: () => void }) {
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
    <section className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-14">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground mb-2 text-xs">Automation</p>
            <h1 className="text-xl font-semibold tracking-tight">Scheduled Tasks</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">
              Run Agent prompts automatically while the backend is active.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onClose}>
              Back
            </Button>
            <Button onClick={openCreate}>
              <PlusIcon />
              New task
            </Button>
          </div>
        </header>

        {tasksQuery.error ? (
          <p role="alert" className="text-destructive text-sm">
            {tasksQuery.error instanceof Error ? tasksQuery.error.message : String(tasksQuery.error)}
          </p>
        ) : tasksQuery.isLoading ? (
          <p role="status" className="text-muted-foreground text-sm">
            Loading scheduled tasks…
          </p>
        ) : tasks.length === 0 ? (
          <div className="bg-card flex flex-col items-center rounded-xl border px-6 py-14 text-center">
            <CalendarClockIcon className="text-muted-foreground size-8" />
            <p className="mt-4 text-sm font-medium">No scheduled tasks</p>
            <p className="text-muted-foreground mt-1 max-w-sm text-xs">
              Create a once, daily, or weekly task to run an Agent prompt automatically.
            </p>
            <Button className="mt-5" onClick={openCreate}>
              Create your first task
            </Button>
          </div>
        ) : (
          <div className="bg-card divide-y overflow-hidden rounded-xl border">
            {tasks.map((task) => (
              <ScheduledTaskRow
                key={task.id}
                task={task}
                busy={toggleMutation.isPending || deleteMutation.isPending}
                onEdit={() => openEdit(task)}
                onToggle={() => toggleMutation.mutate({ id: task.id, enabled: !task.enabled })}
                onDelete={() => {
                  if (window.confirm(`Delete “${task.title}”?`)) deleteMutation.mutate(task.id)
                }}
              />
            ))}
          </div>
        )}
      </div>

      <ScheduledTaskEditor
        task={editingTask}
        open={editorOpen}
        saving={saveMutation.isPending}
        error={mutationError}
        onOpenChange={setEditorOpen}
        onSave={saveTask}
      />
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
          <h2 className="truncate text-sm font-medium">{task.title}</h2>
          <span
            className={task.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}
          >
            {task.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{formatSchedule(task.schedule)}</p>
        <p className="text-muted-foreground mt-1 text-xs">Next: {formatNextRun(task)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onToggle} disabled={busy}>
          {task.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onEdit} disabled={busy} aria-label="Edit task">
          <PencilIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={busy}
          aria-label="Delete task"
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
  const [form, setForm] = useState<FormState>(() => createFormState())
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(createFormState(task))
      setFormError(null)
    }
  }, [open, task])

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
          <DialogTitle>{task ? 'Edit scheduled task' : 'New scheduled task'}</DialogTitle>
          <DialogDescription>Choose a simple schedule for an Agent prompt.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Title">
            <Input value={form.title} onChange={(event) => update('title', event.target.value)} />
          </Field>
          <Field label="Prompt">
            <Textarea
              value={form.prompt}
              onChange={(event) => update('prompt', event.target.value)}
              rows={5}
              placeholder="What should the Agent do?"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Schedule">
              <Select
                value={form.type}
                onValueChange={(value) => update('type', value as FormState['type'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Once</SelectItem>
                  <SelectItem value="daily">Every day</SelectItem>
                  <SelectItem value="weekly">Every week</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.type === 'weekly' ? (
              <Field label="Weekday">
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
              <Field label={form.type === 'once' ? 'Run at' : 'Time'}>
                <Input
                  type={form.type === 'once' ? 'datetime-local' : 'time'}
                  value={form.type === 'once' ? form.runAt : form.time}
                  onChange={(event) => update(form.type === 'once' ? 'runAt' : 'time', event.target.value)}
                />
              </Field>
            )}
          </div>
          {form.type === 'weekly' && (
            <Field label="Time">
              <Input type="time" value={form.time} onChange={(event) => update('time', event.target.value)} />
            </Field>
          )}
          <Field label="Skill IDs">
            <Input
              value={form.skillIds}
              onChange={(event) => update('skillIds', event.target.value)}
              placeholder="Optional, comma separated"
            />
          </Field>
          <Field label="Session ID">
            <Input
              value={form.sessionId}
              onChange={(event) => update('sessionId', event.target.value)}
              placeholder="Optional existing session ID"
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
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save task'}
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
      sessionId: '',
    }
  }

  return {
    title: task.title,
    prompt: task.prompt,
    type: task.schedule.type,
    runAt: task.schedule.type === 'once' ? toDateTimeLocal(task.schedule.runAt) : toDateTimeLocal(Date.now()),
    time: task.schedule.type === 'once' ? '09:00' : task.schedule.time,
    weekday: task.schedule.type === 'weekly' ? task.schedule.weekday : 1,
    skillIds: task.skillIds?.join(', ') ?? '',
    sessionId: task.sessionId ?? '',
  }
}

function toSchedule(form: FormState): ScheduledTaskSchedule {
  if (form.type === 'once') {
    const runAt = new Date(form.runAt).getTime()
    if (!Number.isFinite(runAt)) throw new Error('Choose a valid run time')
    return { type: 'once', runAt }
  }
  if (form.type === 'daily') return { type: 'daily', time: form.time }
  return { type: 'weekly', weekday: form.weekday, time: form.time }
}

function formatSchedule(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === 'once') return `Once · ${formatDate(schedule.runAt)}`
  if (schedule.type === 'daily') return `Every day · ${schedule.time}`
  return `Every ${WEEKDAYS[schedule.weekday]?.label ?? 'week'} · ${schedule.time}`
}

function formatNextRun(task: ScheduledTask): string {
  if (!task.enabled || task.nextRunAt === undefined) return 'No upcoming run'
  const date = new Date(task.nextRunAt)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (sameDate(date, today)) return `Today ${time}`
  if (sameDate(date, tomorrow)) return `Tomorrow ${time}`
  return formatDate(task.nextRunAt)
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

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
