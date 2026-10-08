import { useEffect, useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import {
  DEFAULT_AGENT_COMPACTION_SETTINGS,
  type AgentCompactionSettings,
} from '@/shared/agent/agentConfig'
import { getAgentCompactionSettingsErrors } from '@/shared/agent/agentContextBudget'
import { formatContextTokens } from '@/shared/agent/contextTokens'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SettingsField } from './SettingsComponents'

export function ContextSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  const [compaction, setCompaction] = useState<AgentCompactionSettings>(
    settings.compaction ?? DEFAULT_AGENT_COMPACTION_SETTINGS,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const contextWindow = settings.contextWindow
  const modelName =
    settings.models.find(
      (model) => model.provider === settings.provider && model.modelID === settings.modelID,
    )?.modelName ?? settings.modelID
  const validationErrors = getAgentCompactionSettingsErrors(compaction, contextWindow)
  const invalid = Object.keys(validationErrors).length > 0

  const { enabled, reserveTokens, keepRecentTokens } =
    settings.compaction ?? DEFAULT_AGENT_COMPACTION_SETTINGS

  useEffect(() => {
    setCompaction({ enabled, reserveTokens, keepRecentTokens })
  }, [enabled, reserveTokens, keepRecentTokens])

  const save = async () => {
    if (invalid) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await window.api.updateAgentSettings({ compaction })
      await onChanged()
      setSaved(true)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '上下文设置保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="上下文设置">
      <div>
        <SettingsField label="默认模型">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={modelName}>
              {modelName}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {settings.providerName ?? settings.provider}
              <span className="mx-2">·</span>
              <span title={contextWindow?.toLocaleString('en-US')}>
                {contextWindow ? formatContextTokens(contextWindow) : '未知'} 上下文
              </span>
            </p>
          </div>
        </SettingsField>
        <SettingsField label="自动压缩" description="接近上下文上限时整理历史内容。">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <input
              type="checkbox"
              aria-label="自动压缩"
              className="accent-foreground size-4"
              checked={compaction.enabled}
              onChange={(event) => {
                setCompaction((current) => ({ ...current, enabled: event.target.checked }))
                setSaved(false)
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || invalid}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </SettingsField>
        <details open={invalid || undefined} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
            高级参数
            <ChevronRightIcon className="text-muted-foreground size-4 transition-transform group-open:rotate-90" />
          </summary>
          <div className="grid">
            <CompactionFields
              compaction={compaction}
              setCompaction={setCompaction}
              validationErrors={validationErrors}
              setSaved={setSaved}
            />
          </div>
        </details>
      </div>
      {error && (
        <p role="alert" className="text-destructive px-5 pb-3 text-xs">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-emerald-600 px-5 pb-3 text-xs">
          上下文设置已保存。
        </p>
      )}
    </section>
  )
}

function CompactionFields({
  compaction,
  setCompaction,
  validationErrors,
  setSaved,
}: {
  compaction: AgentCompactionSettings
  setCompaction: React.Dispatch<React.SetStateAction<AgentCompactionSettings>>
  validationErrors: ReturnType<typeof getAgentCompactionSettingsErrors>
  setSaved: (saved: boolean) => void
}) {
  return (
    <>
      <SettingsField label="预留 Token" description="为压缩后的继续执行保留的 token 数量">
        <div className="grid gap-1.5">
          <Input
            type="number"
            min={0}
            step={1}
            aria-label="预留 Token"
            aria-invalid={Boolean(validationErrors.reserveTokens)}
            aria-describedby={validationErrors.reserveTokens ? 'context-reserve-error' : undefined}
            value={compaction.reserveTokens}
            onChange={(event) => {
              setCompaction((current) => ({
                ...current,
                reserveTokens: Number(event.target.value),
              }))
              setSaved(false)
            }}
          />
          {validationErrors.reserveTokens && (
            <p id="context-reserve-error" role="alert" className="text-destructive text-xs">
              {validationErrors.reserveTokens}
            </p>
          )}
        </div>
      </SettingsField>
      <SettingsField label="保留最近 Token" description="压缩时保留最近消息的 token 数量">
        <div className="grid gap-1.5">
          <Input
            type="number"
            min={0}
            step={1}
            aria-label="保留最近 Token"
            aria-invalid={Boolean(validationErrors.keepRecentTokens)}
            aria-describedby={
              validationErrors.keepRecentTokens ? 'context-keep-recent-error' : undefined
            }
            value={compaction.keepRecentTokens}
            onChange={(event) => {
              setCompaction((current) => ({
                ...current,
                keepRecentTokens: Number(event.target.value),
              }))
              setSaved(false)
            }}
          />
          {validationErrors.keepRecentTokens && (
            <p id="context-keep-recent-error" role="alert" className="text-destructive text-xs">
              {validationErrors.keepRecentTokens}
            </p>
          )}
        </div>
      </SettingsField>
    </>
  )
}
