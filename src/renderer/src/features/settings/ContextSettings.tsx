import { useEffect, useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import {
  DEFAULT_AGENT_COMPACTION_SETTINGS,
  type AgentCompactionSettings,
} from '@/shared/agent/agentConfig'
import {
  calculateAgentContextBudget,
  getAgentCompactionSettingsErrors,
} from '@/shared/agent/agentContextBudget'
import { formatContextTokens } from '@/shared/agent/contextTokens'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SettingsCard, SettingsField } from './SettingsComponents'

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
  const budget = calculateAgentContextBudget({ contextWindow }, compaction)

  useEffect(() => {
    setCompaction(settings.compaction ?? DEFAULT_AGENT_COMPACTION_SETTINGS)
  }, [settings])

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
      <SettingsCard>
        <div className="border-border/70 border-b px-4 py-3.5">
          <p className="text-muted-foreground text-xs">当前默认模型</p>
          <p className="mt-1 text-sm font-medium">{modelName}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {settings.providerName ?? settings.provider}
          </p>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">上下文窗口</span>
            <span className="tabular-nums" title={contextWindow?.toLocaleString('en-US')}>
              {budget.contextWindow ? formatContextTokens(budget.contextWindow) : '未知'}
            </span>
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 px-4 py-3.5">
          <div>
            <p className="text-sm font-medium">自动压缩</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              接近模型上下文限制时自动整理历史内容。
            </p>
            {compaction.enabled &&
              budget.contextWindow !== undefined &&
              budget.contextWindow > 0 &&
              !validationErrors.reserveTokens && (
                <p className="text-muted-foreground mt-2 text-xs leading-5">
                  当前配置预计在约 {formatContextTokens(budget.usableTokens!)} token
                  时开始为上下文压缩预留空间。
                </p>
              )}
          </div>
          <input
            type="checkbox"
            aria-label="自动压缩"
            className="accent-foreground mt-0.5 size-4"
            checked={compaction.enabled}
            onChange={(event) => {
              setCompaction((current) => ({ ...current, enabled: event.target.checked }))
              setSaved(false)
            }}
          />
        </div>
        <details
          open={invalid || undefined}
          className="group border-border/70 border-t px-4 py-3.5"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="text-text-muted size-4 transition-transform group-open:rotate-90" />
            高级参数
          </summary>
          <div className="mt-3 grid gap-3">
            <SettingsField label="预留 Token" description="为压缩后的继续执行保留的 token 数量">
              <div className="grid gap-1.5">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  aria-label="预留 Token"
                  aria-invalid={Boolean(validationErrors.reserveTokens)}
                  aria-describedby={
                    validationErrors.reserveTokens ? 'context-reserve-error' : undefined
                  }
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
                  <p
                    id="context-keep-recent-error"
                    role="alert"
                    className="text-destructive text-xs"
                  >
                    {validationErrors.keepRecentTokens}
                  </p>
                )}
              </div>
            </SettingsField>
          </div>
        </details>
      </SettingsCard>
      {error && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-emerald-600 mt-3 text-sm">
          上下文设置已保存。
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={saving || invalid}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
    </section>
  )
}
