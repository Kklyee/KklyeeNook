import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { BotSummary } from '@kklyeenook/shared/bot/bot'
import type { BotEditorOptions } from '@kklyeenook/ui/components/bot-editor'
import { api } from './api'

const BotContext = createContext<{
  bots: BotSummary[]
  options: BotEditorOptions
  error: string
  loading: boolean
  reload(): Promise<void>
}>({
  bots: [],
  options: { tools: [], workspaces: [] },
  error: '',
  loading: true,
  reload: async () => {},
})

export function BotProvider({ children }: { children: ReactNode }) {
  const [bots, setBots] = useState<BotSummary[]>([])
  const [options, setOptions] = useState<BotEditorOptions>({ tools: [], workspaces: [] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    const [bots, options] = await Promise.all([
      api<BotSummary[]>('/bots'),
      api<BotEditorOptions>('/bot-options'),
    ])
    setBots(bots)
    setOptions(options)
    setError('')
    setLoading(false)
  }, [])
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const [bots, options] = await Promise.all([
          api<BotSummary[]>('/bots'),
          api<BotEditorOptions>('/bot-options'),
        ])
        if (active) {
          setBots(bots)
          setOptions(options)
          setError('')
          setLoading(false)
        }
      } catch (error) {
        if (active) {
          setError((error as Error).message)
          setLoading(false)
        }
      }
    }
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, 2500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  return (
    <BotContext.Provider value={{ bots, options, error, loading, reload }}>
      {children}
    </BotContext.Provider>
  )
}

export const useBots = () => useContext(BotContext)
