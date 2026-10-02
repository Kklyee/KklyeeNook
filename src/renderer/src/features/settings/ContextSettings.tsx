import { useEffect, useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import {
  DEFAULT_AGENT_COMPACTION_SETTINGS,
  type AgentCompactionSettings,
} from '@/shared/agent/agentConfig'
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

  useEffect(() => {
    setCompaction(settings.compaction ?? DEFAULT_AGENT_COMPACTION_SETTINGS)
  }, [settings])

  const save = async () => {
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
        <div className="flex items-start justify-between gap-4 px-4 py-3.5">
          <div>
            <p className="text-sm font-medium">自动压缩</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              接近模型上下文限制时自动整理历史内容。
            </p>
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
        <details className="group border-border/70 border-t px-4 py-3.5">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="text-text-muted size-4 transition-transform group-open:rotate-90" />
            高级参数
          </summary>
          <div className="mt-3 grid gap-3">
            <SettingsField label="预留 Token" description="为压缩后的继续执行保留的 token 数量">
              <Input
                type="number"
                min={0}
                step={1}
                value={compaction.reserveTokens}
                onChange={(event) => {
                  setCompaction((current) => ({
                    ...current,
                    reserveTokens: Number(event.target.value),
                  }))
                  setSaved(false)
                }}
              />
            </SettingsField>
            <SettingsField label="保留最近 Token" description="压缩时保留最近消息的 token 数量">
              <Input
                type="number"
                min={0}
                step={1}
                value={compaction.keepRecentTokens}
                onChange={(event) => {
                  setCompaction((current) => ({
                    ...current,
                    keepRecentTokens: Number(event.target.value),
                  }))
                  setSaved(false)
                }}
              />
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
        <Button type="button" variant="outline" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
    </section>
  )
}
