import { useEffect, useState } from 'react'
import { RefreshCwIcon, SparklesIcon } from 'lucide-react'
import type { AgentSkill } from '@/shared/agent/agentSkill'
import { Button } from '../../components/ui/button'
import { SettingsCard } from './SettingsComponents'

export function SkillSettings() {
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [loadStatus, setLoadStatus] = useState<'loading' | 'refreshing' | null>('loading')
  const [error, setError] = useState<string | null>(null)
  const loading = loadStatus === 'loading'
  const reloading = loadStatus === 'refreshing'

  const loadSkills = async (reload: boolean) => {
    setLoadStatus(reload ? 'refreshing' : 'loading')
    setError(null)
    try {
      const request = reload ? window.api.reloadAgentSkills() : window.api.listAgentSkills()
      const nextSkills = await request
      setSkills(nextSkills)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Skills 读取失败，请重试。')
    } finally {
      setLoadStatus(null)
    }
  }

  useEffect(() => {
    void loadSkills(false)
  }, [])

  return (
    <section aria-labelledby="skills-section-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="skills-section-title" className="text-xs font-medium">
            可用 Skills
          </h2>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || reloading}
          onClick={() => void loadSkills(true)}
        >
          <RefreshCwIcon className={reloading ? 'animate-spin' : undefined} />
          刷新
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-muted-foreground text-sm">
          正在读取 Skills…
        </p>
      ) : skills.length === 0 ? (
        <div className="glass-surface rounded-xl border-dashed px-5 py-9 text-center">
          <SparklesIcon className="text-muted-foreground/60 mx-auto size-5" />
          <p className="mt-3 text-sm font-medium">暂无可用 Skills</p>
          <p className="text-muted-foreground mt-1 text-xs">添加的 Skills 会显示在这里。</p>
        </div>
      ) : (
        <SettingsCard>
          {skills.map((skill) => (
            <div key={skill.id} className="px-4 py-3.5">
              <p className="text-sm font-medium">{skill.name}</p>
              <p className="text-muted-foreground mt-1 break-all font-mono text-xs">/{skill.id}</p>
              {skill.description && (
                <p className="text-muted-foreground mt-1 text-xs">{skill.description}</p>
              )}
            </div>
          ))}
        </SettingsCard>
      )}
    </section>
  )
}
