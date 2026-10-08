import { useEffect, useState } from 'react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'
import { WEB_SEARCH_ERROR_LABELS, type WebSearchProviderId } from '@/shared/web-search/webSearch'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../components/ui/select'
import { SettingsField } from './SettingsComponents'

const providerLabels: Record<WebSearchProviderId, string> = {
  disabled: '已禁用',
  tavily: 'Tavily',
  exa: 'Exa',
}

export function WebSearchSettings({
  settings,
  onChanged,
}: {
  settings: AgentSettingsSnapshot
  onChanged: () => Promise<void>
}) {
  const provider = settings.webSearch.provider
  const activeProvider = settings.webSearch.providers.find((item) => item.id === provider)
  const hasApiKey = activeProvider?.hasApiKey ?? false
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState<'provider' | 'key' | 'delete' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setApiKey('')
    setError(null)
    setNotice(null)
  }, [provider])

  const changeProvider = async (value: string | null) => {
    if (!value) return
    setBusy('provider')
    setError(null)
    setNotice(null)
    try {
      await window.api.updateAgentSettings({
        webSearch: { provider: value as WebSearchProviderId },
      })
      await onChanged()
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : '保存失败')
    } finally {
      setBusy(null)
    }
  }

  const saveApiKey = async () => {
    if (provider === 'disabled' || !apiKey.trim()) return
    setBusy('key')
    setError(null)
    setNotice(null)
    try {
      await window.api.updateAgentSettings({
        webSearchCredential: { provider, apiKey: apiKey.trim() },
      })
      await onChanged()
      setApiKey('')
      setNotice('API Key 已保存。')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setBusy(null)
    }
  }

  const deleteApiKey = async () => {
    if (provider === 'disabled') return
    setBusy('delete')
    setError(null)
    setNotice(null)
    try {
      await window.api.updateAgentSettings({
        webSearchCredential: { provider, deleteApiKey: true },
      })
      await onChanged()
      setNotice('API Key 已清除。')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '清除失败')
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async () => {
    if (provider === 'disabled') return
    setBusy('test')
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.testWebSearchConnection({
        provider,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      if (result.ok) setNotice('连接成功。')
      else setError(`连接失败：${WEB_SEARCH_ERROR_LABELS[result.code]}`)
    } catch {
      setError('连接测试失败，请重试。')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="网络搜索设置">
      <div>
        <SettingsField label="搜索服务">
          <Select value={provider} onValueChange={(value) => void changeProvider(value)}>
            <SelectTrigger aria-label="搜索服务" disabled={busy !== null}>
              {providerLabels[provider]}
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(providerLabels) as WebSearchProviderId[]).map((id) => (
                <SelectItem key={id} value={id}>
                  {providerLabels[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>

        <SettingsField
          className="sm:items-start"
          label={
            <span className="flex min-h-8 flex-wrap items-center gap-2">
              API Key
              <span
                className={
                  hasApiKey && provider !== 'disabled'
                    ? 'text-emerald-600 text-[11px] font-normal'
                    : 'text-muted-foreground text-[11px] font-normal'
                }
              >
                {provider === 'disabled' ? '已禁用' : hasApiKey ? '已配置' : '未配置'}
              </span>
            </span>
          }
        >
          <div className="grid gap-2.5">
            <Input
              type="password"
              aria-label="网络搜索 API Key"
              value={apiKey}
              disabled={provider === 'disabled' || busy !== null}
              placeholder={hasApiKey ? '输入新密钥以替换' : '输入 API Key'}
              onChange={(event) => {
                setApiKey(event.target.value)
                setNotice(null)
              }}
            />
            {provider !== 'disabled' && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {hasApiKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground mr-auto px-2 text-xs"
                      disabled={busy !== null}
                      onClick={() => void deleteApiKey()}
                    >
                      {busy === 'delete' ? '清除中…' : '清除'}
                    </Button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy !== null || (!hasApiKey && !apiKey.trim())}
                      onClick={() => void testConnection()}
                    >
                      {busy === 'test' ? '测试中…' : '测试连接'}
                    </Button>
                    {apiKey.trim() && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void saveApiKey()}
                      >
                        {busy === 'key' ? '保存中…' : '保存'}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-muted-foreground text-[11px]">测试可能消耗一次搜索额度。</p>
              </>
            )}
          </div>
        </SettingsField>
      </div>

      {error && (
        <p role="alert" className="text-destructive px-5 pb-3 text-xs">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-600 px-5 pb-3 text-xs">
          {notice}
        </p>
      )}
    </section>
  )
}
