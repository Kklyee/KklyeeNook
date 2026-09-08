import { useEffect, useState } from 'react'
import type { AgentSettingsSnapshot } from '@/shared/agent/agentSettings'

export function useAgentSettings() {
  const [settings, setSettings] = useState<AgentSettingsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    window.api.getAgentSettings().then(
      (value) => {
        if (!disposed) setSettings(value)
      },
      () => {
        if (!disposed) setError('配置读取失败，请重启桌面应用后重试。')
      },
    )
    return () => {
      disposed = true
    }
  }, [])

  return { settings, error }
}
