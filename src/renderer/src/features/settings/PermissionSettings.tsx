import { useState } from 'react'
import {
  PERMISSION_LABELS,
  PERMISSION_MODES,
  type PermissionMode,
} from '@/shared/approval/permission'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { notifyWorkspaceChanged } from '../workspaces/WorkspaceProvider'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/select'
import { Button } from '../../components/ui/button'
import { SettingsField } from './SettingsComponents'
import { Trash2Icon } from 'lucide-react'

const toolDescriptions: Record<string, string> = {
  read: '读取文件',
  edit: '编辑文件',
  write: '写入文件',
  bash: '执行命令',
  update_plan: '更新计划',
  save_memory: '保存记忆',
  delegate_task: '委派子任务',
  search_knowledge: '检索 Knowledge',
  read_knowledge: '读取 Knowledge',
}

export function PermissionSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const permissionGrants = Array.isArray(settings.permissionGrants) ? settings.permissionGrants : []

  const change = async (mode: PermissionMode | null) => {
    if (!mode) return
    setError(null)
    try {
      await window.api.updateAgentSettings({ defaultPermissionMode: mode })
      await onChanged()
      notifyWorkspaceChanged()
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败')
    }
  }

  const revoke = async (id: string) => {
    setRevoking(id)
    setRevokeError(null)
    try {
      await window.api.deletePermissionGrant({ id })
      await onChanged()
    } catch {
      setRevokeError('权限撤销失败，请重试。')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="divide-y divide-border/60">
      <section aria-label="默认权限">
        <SettingsField
          label="默认权限"
          description="适用于新会话。工作区外操作和受限模式下的命令需单次审批。未分组会话无法使用工作区内修改。"
        >
          <div>
            <Select
              value={settings.defaultPermissionMode ?? 'workspace-write'}
              onValueChange={(value) => void change(value)}
            >
              <SelectTrigger aria-label="默认权限">
                {PERMISSION_LABELS[settings.defaultPermissionMode ?? 'workspace-write']}
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {PERMISSION_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error && (
              <p role="alert" className="text-destructive mt-2 text-xs">
                {error}
              </p>
            )}
          </div>
        </SettingsField>
      </section>

      <section aria-labelledby="permission-grants-title" className="px-4 pt-3.5">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 id="permission-grants-title" className="text-sm font-medium">
              临时授权
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">你可以查看或撤销已授予的权限。</p>
          </div>
          <span className="text-muted-foreground text-xs">{permissionGrants.length} 个授权</span>
        </div>
        {revokeError && (
          <p role="alert" className="text-destructive mb-3 text-sm">
            {revokeError}
          </p>
        )}
        {permissionGrants.length === 0 ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            当前没有临时授权，需要授权的操作会显示在这里。
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {permissionGrants.map((grant) => (
              <div key={grant.id} className="flex items-start justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span>
                      {toolDescriptions[grant.permission.toolName] ?? grant.permission.toolName}
                    </span>
                    <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-[10px] uppercase">
                      {grant.duration}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="撤销权限"
                  title="撤销权限"
                  disabled={revoking === grant.id}
                  onClick={() => void revoke(grant.id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
