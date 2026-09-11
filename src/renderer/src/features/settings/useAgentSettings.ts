import { useCallback, useEffect, useState } from 'react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'

export function useAgentSettings() {
  const [settings, setSettings] = useState<AgentSettingsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    return window.api.getAgentSettings().then(
      (value) => {
        setSettings(value)
      },
      () => {
        setError('配置读取失败，请重启桌面应用后重试。')
      },
    )
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { settings, error, reload }
}
