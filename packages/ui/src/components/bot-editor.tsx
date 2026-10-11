import { useState } from 'react'
import { ArrowLeftIcon, ChevronDownIcon, CopyIcon, RotateCcwIcon, TrashIcon } from 'lucide-react'
import {
  AVATAR_VARIANTS,
  BOT_COLORS,
  type BotInput,
  type BotProfile,
} from '@kklyeenook/shared/bot/bot'
import type { Workspace } from '@kklyeenook/shared/workspace/workspace'
import { PERMISSION_LABELS, PERMISSION_MODES } from '@kklyeenook/shared/approval/permission'
import { BotAvatar } from './bot-avatar'
import { Button } from './button'
import { Input } from './input'
import { Textarea } from './textarea'
import { Select, SelectContent, SelectItem, SelectTrigger } from './select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './dialog'

export type BotModelOption = { provider: string; modelId: string; name: string }
export type BotEditorOptions = {
  workspaces: Workspace[]
  tools: { name: string; description: string }[]
}

const palettes = [
  BOT_COLORS,
  ['#f3b66d', '#e89bad', '#65597c', '#faf0df', '#6bbfaf'],
  ['#ad9ee9', '#719bb6', '#d2dff0', '#f8f5ed', '#43505c'],
  ['#e89bad', '#c8d5b9', '#687b75', '#f8f5ed', '#f3b66d'],
]

export function BotEditor({
  profile,
  creating,
  options,
  models,
  onSave,
  onBack,
  onDuplicate,
  onDelete,
  onReset,
}: {
  profile: BotProfile
  creating: boolean
  options: BotEditorOptions
  models: BotModelOption[]
  onSave(input: BotInput, start: boolean): Promise<void>
  onBack(): void
  onDuplicate?(): Promise<void>
  onDelete?(): Promise<void>
  onReset?(): Promise<void>
}) {
  const [draft, setDraft] = useState(() => structuredClone(profile))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<'delete' | 'reset'>()
  const change = (value: Partial<BotProfile>) => setDraft((current) => ({ ...current, ...value }))
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      setConfirm(undefined)
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  const save = (start: boolean) =>
    run(async () => {
      const {
        name,
        role,
        kind,
        instructions,
        avatar,
        model,
        thinkingLevel,
        enabledTools,
        workspaceIds,
        defaultWorkspaceId,
        permissionMode,
      } = draft
      const input = {
        name,
        role,
        kind,
        instructions,
        avatar,
        model,
        thinkingLevel,
        enabledTools,
        workspaceIds,
        defaultWorkspaceId,
        permissionMode,
      }
      await onSave(input, start)
    })
  const toggleWorkspace = (id: string, enabled: boolean) =>
    change({
      workspaceIds: enabled
        ? [...draft.workspaceIds, id]
        : draft.workspaceIds.filter((value) => value !== id),
      defaultWorkspaceId:
        !enabled && draft.defaultWorkspaceId === id ? null : draft.defaultWorkspaceId,
    })
  const modelKey = draft.model ? `${draft.model.provider}/${draft.model.modelId}` : 'inherit'
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <form
        className="mx-auto w-full max-w-5xl space-y-7 px-5 py-6 sm:px-8"
        onSubmit={(event) => {
          event.preventDefault()
          void save(false)
        }}
      >
        <header className="flex items-center gap-3 border-b border-border pb-6">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="返回 Chat">
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {creating ? 'Create a Bot' : `编辑 ${profile.name}`}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">给你的伙伴一个名字和擅长的工作</p>
          </div>
        </header>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="grid min-w-0 gap-7 md:grid-cols-[1fr_220px]">
          <div className="space-y-5">
            <label className="block space-y-2">
              <span className="text-sm text-muted-foreground">Bot Name</span>
              <Input
                required
                maxLength={100}
                value={draft.name}
                onChange={(event) => change({ name: event.target.value })}
                placeholder="例如：Nova"
                className="h-11"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm text-muted-foreground">Role</span>
              <Input
                maxLength={500}
                value={draft.role}
                onChange={(event) => change({ role: event.target.value })}
                placeholder="例如：Research Assistant"
                className="h-11"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm text-muted-foreground">Instructions</span>
              <Textarea
                maxLength={64000}
                value={draft.instructions}
                onChange={(event) => change({ instructions: event.target.value })}
                className="min-h-32"
                placeholder="描述它应如何帮助你…"
              />
            </label>
          </div>
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-muted/40 p-5">
            <BotAvatar avatar={draft.avatar} name={draft.name || 'Bot'} size={108} />
            <span className="text-sm font-medium">Avatar Preview</span>
            <div className="flex gap-2">
              {palettes.map((colors, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`调色板 ${index + 1}`}
                  onClick={() =>
                    change({
                      avatar: { ...draft.avatar, colors: [...colors], accentColor: colors[0] },
                    })
                  }
                  className="size-7 rounded-full border-2 border-border focus-visible:outline-2 focus-visible:outline-ring"
                  style={{ background: colors[0] }}
                />
              ))}
            </div>
            <Choice
              label="头像风格"
              value={draft.avatar.variant}
              items={AVATAR_VARIANTS.map((variant) => ({ id: variant, name: variant }))}
              onChange={(variant) =>
                change({
                  avatar: { ...draft.avatar, variant: variant as BotProfile['avatar']['variant'] },
                })
              }
            />
            <label className="flex w-full items-center justify-between text-xs text-muted-foreground">
              强调色
              <input
                aria-label="强调色"
                type="color"
                value={draft.avatar.accentColor}
                onChange={(event) =>
                  change({ avatar: { ...draft.avatar, accentColor: event.target.value } })
                }
                className="h-7 w-10 cursor-pointer bg-transparent"
              />
            </label>
            <div className="flex gap-1.5">
              {draft.avatar.colors.map((color, index) => (
                <input
                  key={index}
                  aria-label={`头像颜色 ${index + 1}`}
                  type="color"
                  value={color}
                  onChange={(event) =>
                    change({
                      avatar: {
                        ...draft.avatar,
                        colors: draft.avatar.colors.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      },
                    })
                  }
                  className="h-6 w-7 cursor-pointer bg-transparent"
                />
              ))}
            </div>
          </div>
        </fieldset>
        <fieldset disabled={busy} className="space-y-6 border-t border-border pt-6">
          <details>
            <summary className="flex cursor-pointer list-none items-center justify-between text-base font-medium">
              Model & Tools <ChevronDownIcon className="size-4" />
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              默认继承应用模型。工具决定 Bot 可以使用哪些能力；每次执行仍经过权限和 Sandbox 检查。
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Choice
                label="模型"
                value={modelKey}
                items={[
                  { id: 'inherit', name: '继承应用默认模型' },
                  ...models.map((model) => ({
                    id: `${model.provider}/${model.modelId}`,
                    name: model.name,
                  })),
                ]}
                onChange={(key) => {
                  const model = models.find((model) => `${model.provider}/${model.modelId}` === key)
                  change({
                    model: model ? { provider: model.provider, modelId: model.modelId } : null,
                  })
                }}
              />
              <Choice
                label="Thinking Level"
                value={draft.thinkingLevel ?? 'inherit'}
                items={['inherit', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(
                  (id) => ({ id, name: id === 'inherit' ? '继承应用默认' : id }),
                )}
                onChange={(value) =>
                  change({
                    thinkingLevel:
                      value === 'inherit' ? null : (value as BotProfile['thinkingLevel']),
                  })
                }
              />
              <Choice
                label="工作方式"
                value={draft.kind}
                items={[
                  { id: 'personal', name: '个人助手' },
                  { id: 'coding', name: '代码开发 · 加载 AGENTS.md' },
                ]}
                onChange={(kind) => change({ kind: kind as BotProfile['kind'] })}
              />
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {options.tools.map((tool) => (
                <label
                  key={tool.name}
                  title={tool.description}
                  className="flex min-w-0 items-center min-h-11 gap-2 rounded-lg py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={draft.enabledTools.includes(tool.name)}
                    onChange={(event) =>
                      change({
                        enabledTools: event.target.checked
                          ? [...draft.enabledTools, tool.name]
                          : draft.enabledTools.filter((name) => name !== tool.name),
                      })
                    }
                  />
                  <span className="truncate">{tool.name}</span>
                </label>
              ))}
            </div>
          </details>
          <section className="space-y-4 border-t border-border pt-6">
            <h2 className="text-base font-medium">Workspace Access</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              仅可访问已授权的 Workspace。绑定 Workspace 不会更改 Bot
              的身份。撤权立即阻止后续工具操作。
            </p>
            {!options.workspaces.length && (
              <p className="text-sm text-muted-foreground">
                尚未关联 Workspace，可先创建 Bot；在应用设置中添加 Workspace 后再授权。
              </p>
            )}
            <div className="space-y-2">
              {options.workspaces.map((workspace) => (
                <label key={workspace.id} className="flex items-center min-h-11 gap-3 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.workspaceIds.includes(workspace.id)}
                    disabled={
                      workspace.status !== 'attached' && !draft.workspaceIds.includes(workspace.id)
                    }
                    onChange={(event) => toggleWorkspace(workspace.id, event.target.checked)}
                  />
                  <span>{workspace.displayName}</span>
                  {workspace.status !== 'attached' && (
                    <span className="text-xs text-warning">不可用</span>
                  )}
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice
                label="默认 Workspace"
                value={draft.defaultWorkspaceId ?? 'none'}
                items={[
                  { id: 'none', name: '无 · 主会话保持独立' },
                  ...options.workspaces
                    .filter((workspace) => draft.workspaceIds.includes(workspace.id))
                    .map((workspace) => ({ id: workspace.id, name: workspace.displayName })),
                ]}
                onChange={(id) => change({ defaultWorkspaceId: id === 'none' ? null : id })}
              />
              <Choice
                label="权限模式"
                value={draft.permissionMode}
                items={PERMISSION_MODES.map((id) => ({ id, name: PERMISSION_LABELS[id] }))}
                onChange={(permissionMode) =>
                  change({ permissionMode: permissionMode as BotProfile['permissionMode'] })
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              新提交使用保存后的配置；运行中的任务保留已捕获的身份、指令和模型。
            </p>
          </section>
        </fieldset>
        <footer className="flex flex-wrap items-center gap-2 border-t border-border pt-6">
          {!creating && (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => void run(onDuplicate!)}>
                <CopyIcon />
                复制 Bot
              </Button>
              {profile.isBuiltIn ? (
                <Button variant="ghost" disabled={busy} onClick={() => setConfirm('reset')}>
                  <RotateCcwIcon />
                  恢复默认
                </Button>
              ) : (
                <Button variant="destructive" disabled={busy} onClick={() => setConfirm('delete')}>
                  <TrashIcon />
                  删除
                </Button>
              )}
            </>
          )}
          <div className="ml-auto flex w-full flex-wrap justify-end gap-2 sm:w-auto">
            <Button variant="outline" onClick={onBack} disabled={busy}>
              返回 Chat
            </Button>
            <Button type="submit" disabled={busy || !draft.name.trim()}>
              保存
            </Button>
            <Button disabled={busy || !draft.name.trim()} onClick={() => void save(true)}>
              保存并开始对话
            </Button>
          </div>
        </footer>
      </form>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'delete' ? `删除 ${profile.name}？` : '恢复默认配置？'}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'delete'
                ? '所有会话将归档，Workspace 授权将解除，项目文件不会删除。有运行或排队任务时禁止删除。'
                : '身份、外观、模型、工具及 Workspace 授权将恢复默认。历史主会话会保留。'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(undefined)}>
              取消
            </Button>
            <Button
              variant={confirm === 'delete' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void run(confirm === 'delete' ? onDelete! : onReset!)}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Choice({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: string
  items: { id: string; name: string }[]
  onChange(value: string): void
}) {
  return (
    <div className="w-full space-y-2">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <Select
        value={value}
        onValueChange={(value) => {
          if (value) onChange(value)
        }}
      >
        <SelectTrigger aria-label={label}>
          {items.find((item) => item.id === value)?.name ?? value}
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
